import { randomBytes, randomInt } from "node:crypto";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  activePlayers,
  decide,
  evolve,
  gifts,
  leftoverGiftCount,
  newGame,
  onDeck,
  phase,
  roster,
  type Command,
  type DrawFn,
  type Event,
  type GameSettings,
  type GameState,
} from "@elephant/rules";
import { Server as SocketServer } from "socket.io";
import type { z } from "zod";
import { createAuth, DEFAULT_LIMITS, logMailer, SESSION_LIFETIME_MS, type LinkLimits, type Mailer } from "./auth.js";
import { gameEvents, gameHosts, gamePlayers, games, openDb, type Tx } from "./db.js";
import { cohostBody, command, createGameBody, joinBody, linkRedemption, linkRequest } from "./schemas.js";

export type { Mailer } from "./auth.js";

const SESSION_COOKIE = "session";

export interface ServerOptions {
  /** SQLite file path, or ":memory:" for tests. */
  dbPath: string;
  /** Picks who is called up next. Defaults to cryptographic randomness; tests pass a script. */
  draw?: DrawFn;
  /** Sends sign-in links. Defaults to writing them to the server log. */
  mailer?: Mailer;
  /** The clock, so tests can let links expire. */
  now?: () => Date;
  /** Where the web app is served; sign-in links point at its sign-in page. */
  baseUrl?: string;
  /** Limits on emailing sign-in links; any left out take their defaults. */
  limits?: Partial<LinkLimits>;
  /**
   * True when a reverse proxy (Caddy on the droplet) sits in front and sets X-Forwarded-For. Only then is
   * that header believed: otherwise a client could forge it to dodge the per-IP limit.
   */
  trustProxy?: boolean;
}

const randomDraw: DrawFn = (candidates) => candidates[randomInt(candidates.length)]!;

/** A Game as the server holds it: what's stored alongside the log, its state rebuilt from the log, and the log's length. */
interface LoadedGame {
  name: string;
  rosterMode: "host" | "self";
  state: GameState;
  seq: number;
}

/** What screens are shown about a Game: answers from the rules module, never its internal state. */
function view(id: string, { name, rosterMode, state, seq }: LoadedGame) {
  return {
    id,
    name,
    rosterMode,
    /** Rises with every change (it counts the Game's logged events), so a screen keeps the newest copy it has seen. */
    version: seq,
    phase: phase(state),
    settings: state.settings,
    players: roster(state),
    active: activePlayers(state),
    onDeck: onDeck(state),
    gifts: gifts(state),
    /** Unopened Gifts still on the table in the Final Round. */
    leftoverGifts: leftoverGiftCount(state),
  };
}

/** Reads and checks a JSON body; on failure, the 400 response to send instead. */
async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  const raw: unknown = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, res: c.json({ error: "Invalid request", issues: parsed.error.issues }, 400) };
}

export function createServer({
  dbPath,
  draw = randomDraw,
  mailer = logMailer,
  now = () => new Date(),
  baseUrl = "http://localhost:3000",
  limits = {},
  trustProxy = false,
}: ServerOptions) {
  const db = openDb(dbPath);
  const auth = createAuth(db, now, { ...DEFAULT_LIMITS, ...limits });

  function clientIp(c: Context): string {
    if (trustProxy) {
      // The proxy appends the address it saw; anything to the left of that came from the client and could be forged.
      const forwarded = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
      if (forwarded) return forwarded;
    }
    try {
      return getConnInfo(c).remote.address ?? "unknown";
    } catch {
      return "unknown"; // no socket, as in app.request() tests
    }
  }
  const signedInAs = (c: Context) => auth.sessionEmail(getCookie(c, SESSION_COOKIE));
  const roleIn = (gameId: string, email: string) =>
    db.select().from(gameHosts).where(and(eq(gameHosts.gameId, gameId), eq(gameHosts.email, email))).get()?.role;
  /** Rebuilt Games, so a Game's log is replayed only once per server start. `seq` counts its logged events. */
  const cache = new Map<string, LoadedGame>();

  function load(id: string): LoadedGame | undefined {
    const cached = cache.get(id);
    if (cached) return cached;
    const row = db.select().from(games).where(eq(games.id, id)).get();
    if (!row) return undefined;
    const log = db.select().from(gameEvents).where(eq(gameEvents.gameId, id)).orderBy(asc(gameEvents.seq)).all();
    // Replaying the log never draws: every Draw was logged as a PlayerDrawn event (ADR-0001).
    const state = log.map((e) => JSON.parse(e.event) as Event).reduce(evolve, newGame(JSON.parse(row.settings) as GameSettings));
    const game: LoadedGame = { name: row.name, rosterMode: row.rosterMode, state, seq: log.length };
    cache.set(id, game);
    return game;
  }

  /** The Player this person signed up as, if they did and are still on the Roster. */
  function playerOf(gameId: string, email: string, game: LoadedGame): string | undefined {
    const row = db
      .select({ playerId: gamePlayers.playerId })
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.email, email)))
      .get();
    return row && roster(game.state).some((p) => p.id === row.playerId) ? row.playerId : undefined;
  }

  /**
   * Decides a command, logs its events and tells every screen. `alsoWrite` goes in the same transaction,
   * so what's stored beside the log never disagrees with it. Synchronous from start to finish, so two
   * commands never interleave. Returns the Game as now shown, or the rule that refused the command.
   */
  function run(id: string, game: LoadedGame, cmd: Command, alsoWrite?: (tx: Tx) => void) {
    const result = decide(game.state, cmd, draw);
    if (!Array.isArray(result)) return result;
    const at = now();
    db.transaction((tx) => {
      result.forEach((event, i) => {
        tx.insert(gameEvents).values({ gameId: id, seq: game.seq + i + 1, event: JSON.stringify(event), createdAt: at }).run();
      });
      alsoWrite?.(tx);
    });
    const next = { ...game, state: result.reduce(evolve, game.state), seq: game.seq + result.length };
    cache.set(id, next);
    const shown = view(id, next);
    io?.to(id).emit("game", shown);
    return shown;
  }

  /** Set once listening: every screen watching a Game sits in a room named by the Game's id. */
  let io: SocketServer | undefined;

  const app = new Hono();

  // Always 202, whether or not the address has been seen before, so this can't be used to find out who has an account.
  app.post("/api/auth/link", async (c) => {
    const body = await parseBody(c, linkRequest);
    if (!body.ok) return body.res;
    const token = auth.issueLink(body.data.email, clientIp(c));
    if (!token) return c.json({ error: "Too many sign-in links asked for; try again in a few minutes" }, 429);
    // Someone who scanned a Game's QR code goes back to that Game once signed in.
    const next = body.data.next ? `&next=${encodeURIComponent(body.data.next)}` : "";
    // The link opens the web app's sign-in page, which redeems it with a POST. A GET that signed people in
    // would be used up by email scanners (such as Outlook Safe Links) that open every link to check it.
    await mailer.sendSignInLink(body.data.email, `${baseUrl}/sign-in?token=${token}${next}`);
    return c.body(null, 202);
  });

  app.post("/api/auth/verify", async (c) => {
    const body = await parseBody(c, linkRedemption);
    if (!body.ok) return body.res;
    const session = auth.redeemLink(body.data.token);
    if (!session) return c.json({ error: "This sign-in link is used or expired; ask for a new one" }, 401);
    setCookie(c, SESSION_COOKIE, session.sessionToken, {
      httpOnly: true,
      sameSite: "Lax",
      secure: baseUrl.startsWith("https:"),
      path: "/",
      maxAge: SESSION_LIFETIME_MS / 1000,
    });
    return c.json({ email: session.email });
  });

  app.get("/api/session", (c) => {
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Not signed in" }, 401);
    return c.json({ email });
  });

  app.post("/api/auth/sign-out", (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) auth.endSession(token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.body(null, 204);
  });

  app.post("/api/games", async (c) => {
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in to create a Game" }, 401);
    const body = await parseBody(c, createGameBody);
    if (!body.ok) return body.res;
    // 16 random bytes: unguessable, so a Game can't be found without its link or QR code.
    const id = randomBytes(16).toString("base64url");
    db.transaction((tx) => {
      tx.insert(games).values({ id, name: body.data.name, rosterMode: body.data.rosterMode, settings: JSON.stringify(body.data.settings), createdAt: now() }).run();
      tx.insert(gameHosts).values({ gameId: id, email, role: "host" }).run();
    });
    return c.json({ id }, 201);
  });

  /** The Games the signed-in person runs, as Host or Co-host, newest first. */
  app.get("/api/games", (c) => {
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const rows = db
      .select({ id: games.id, role: gameHosts.role })
      .from(gameHosts)
      .innerJoin(games, eq(games.id, gameHosts.gameId))
      .where(eq(gameHosts.email, email))
      .orderBy(desc(games.createdAt), desc(sql`${games}.rowid`))
      .all();
    return c.json(
      rows.map(({ id, role }) => {
        const game = load(id)!;
        return { id, name: game.name, phase: phase(game.state), players: roster(game.state).length, role };
      }),
    );
  });

  app.post("/api/games/:id/cohosts", async (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, cohostBody);
    if (!body.ok) return body.res;
    if (!load(id)) return c.json({ error: "Game not found" }, 404);
    if (roleIn(id, email) !== "host") return c.json({ error: "Only the Host can appoint Co-hosts" }, 403);
    db.insert(gameHosts).values({ gameId: id, email: body.data.email, role: "cohost" }).onConflictDoNothing().run();
    return c.body(null, 204);
  });

  app.get("/api/games/:id", (c) => {
    const id = c.req.param("id");
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    // Only this answer says who is asking: live updates go to everyone watching, so they never carry a role.
    const email = signedInAs(c);
    const playerId = email ? playerOf(id, email, game) : undefined;
    return c.json({ ...view(id, game), role: (email && roleIn(id, email)) ?? null, me: playerId ? { playerId } : null });
  });

  app.post("/api/games/:id/commands", async (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, command);
    if (!body.ok) return body.res;
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (!roleIn(id, email)) return c.json({ error: "Only the Host and Co-hosts can run this Game" }, 403);

    const result = run(id, game, body.data);
    return "code" in result ? c.json(result, 409) : c.json(result);
  });

  // A person adds themselves as a Player, in a Self sign-up Game. The server picks the Player's id and
  // sends the same AddPlayer command the Host's button does, so the rules are untouched.
  app.post("/api/games/:id/join", async (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, joinBody);
    if (!body.ok) return body.res;
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (game.rosterMode !== "self") return c.json({ error: "The Host adds the Players in this Game" }, 403);
    if (playerOf(id, email, game)) return c.json({ code: "AlreadyJoined", message: "You're already playing in this Game" }, 409);

    const playerId = randomBytes(12).toString("base64url");
    const result = run(id, game, { type: "AddPlayer", playerId, name: body.data.name }, (tx) => {
      // A link left over from a Player the Host has since removed gives way to the new one.
      tx.delete(gamePlayers).where(and(eq(gamePlayers.gameId, id), eq(gamePlayers.email, email))).run();
      tx.insert(gamePlayers).values({ gameId: id, playerId, email }).run();
    });
    return "code" in result ? c.json(result, 409) : c.json({ ...result, me: { playerId } });
  });

  /** Serves HTTP and live updates on one port (0 picks a free one). Screens only listen; moves go over HTTP. */
  function listen(port: number): Promise<{ port: number; close: () => Promise<void> }> {
    auth.sweep();
    const sweeping = setInterval(() => auth.sweep(), 60 * 60_000);
    sweeping.unref(); // never what keeps the process alive
    return new Promise((resolve) => {
      const http = serve({ fetch: app.fetch, port }, (info: AddressInfo) => {
        resolve({
          port: info.port,
          close: () => {
            clearInterval(sweeping);
            return new Promise((done) => sockets.close(() => done()));
          },
        });
      });
      const sockets = new SocketServer(http);
      io = sockets;

      sockets.use((socket, next) => {
        const gameId: unknown = socket.handshake.auth["gameId"];
        if (typeof gameId !== "string" || !load(gameId)) return next(new Error("Game not found"));
        next();
      });
      // On every connection, including a phone waking and reconnecting, send the whole Game.
      sockets.on("connection", (socket) => {
        const gameId = socket.handshake.auth["gameId"] as string;
        void socket.join(gameId);
        socket.emit("game", view(gameId, load(gameId)!));
      });
    });
  }

  return { app, listen, sweep: auth.sweep };
}
