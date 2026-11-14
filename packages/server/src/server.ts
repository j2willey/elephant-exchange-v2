import { randomBytes, randomInt } from "node:crypto";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { and, asc, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  activePlayers,
  decide,
  evolve,
  gifts,
  newGame,
  onDeck,
  phase,
  roster,
  type DrawFn,
  type Event,
  type GameSettings,
  type GameState,
} from "@elephant/rules";
import { Server as SocketServer } from "socket.io";
import type { z } from "zod";
import { createAuth, logMailer, SESSION_LIFETIME_MS, type Mailer } from "./auth.js";
import { gameEvents, gameHosts, games, openDb } from "./db.js";
import { cohostBody, command, createGameBody, linkRedemption, linkRequest } from "./schemas.js";

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
}

const randomDraw: DrawFn = (candidates) => candidates[randomInt(candidates.length)]!;

/** What screens are shown about a Game: answers from the rules module, never its internal state. */
function view(id: string, state: GameState) {
  return {
    id,
    phase: phase(state),
    settings: state.settings,
    players: roster(state),
    active: activePlayers(state),
    onDeck: onDeck(state),
    gifts: gifts(state),
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
}: ServerOptions) {
  const db = openDb(dbPath);
  const auth = createAuth(db, now);
  const signedInAs = (c: Context) => auth.sessionEmail(getCookie(c, SESSION_COOKIE));
  const roleIn = (gameId: string, email: string) =>
    db.select().from(gameHosts).where(and(eq(gameHosts.gameId, gameId), eq(gameHosts.email, email))).get()?.role;
  /** Rebuilt Games, so a Game's log is replayed only once per server start. `seq` counts its logged events. */
  const cache = new Map<string, { state: GameState; seq: number }>();

  function load(id: string): { state: GameState; seq: number } | undefined {
    const cached = cache.get(id);
    if (cached) return cached;
    const row = db.select().from(games).where(eq(games.id, id)).get();
    if (!row) return undefined;
    const log = db.select().from(gameEvents).where(eq(gameEvents.gameId, id)).orderBy(asc(gameEvents.seq)).all();
    // Replaying the log never draws: every Draw was logged as a PlayerDrawn event (ADR-0001).
    const state = log.map((e) => JSON.parse(e.event) as Event).reduce(evolve, newGame(JSON.parse(row.settings) as GameSettings));
    const game = { state, seq: log.length };
    cache.set(id, game);
    return game;
  }

  /** Set once listening: every screen watching a Game sits in a room named by the Game's id. */
  let io: SocketServer | undefined;

  const app = new Hono();

  // Always 202, whether or not the address has been seen before, so this can't be used to find out who has an account.
  app.post("/api/auth/link", async (c) => {
    const body = await parseBody(c, linkRequest);
    if (!body.ok) return body.res;
    const token = auth.issueLink(body.data.email);
    // The link opens the web app's sign-in page, which redeems it with a POST. A GET that signed people in
    // would be used up by email scanners (such as Outlook Safe Links) that open every link to check it.
    await mailer.sendSignInLink(body.data.email, `${baseUrl}/sign-in?token=${token}`);
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
      tx.insert(games).values({ id, settings: JSON.stringify(body.data.settings), createdAt: now() }).run();
      tx.insert(gameHosts).values({ gameId: id, email, role: "host" }).run();
    });
    return c.json({ id }, 201);
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
    return c.json(view(id, game.state));
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

    // Everything from here to the cache update is synchronous, so two commands never interleave.
    const result = decide(game.state, body.data, draw);
    if (!Array.isArray(result)) return c.json(result, 409);
    const at = now();
    // One transaction: a command's events are all logged, or none are.
    db.transaction((tx) => {
      result.forEach((event, i) => {
        tx.insert(gameEvents).values({ gameId: id, seq: game.seq + i + 1, event: JSON.stringify(event), createdAt: at }).run();
      });
    });
    const next = { state: result.reduce(evolve, game.state), seq: game.seq + result.length };
    cache.set(id, next);
    const shown = view(id, next.state);
    io?.to(id).emit("game", shown);
    return c.json(shown);
  });

  /** Serves HTTP and live updates on one port (0 picks a free one). Screens only listen; moves go over HTTP. */
  function listen(port: number): Promise<{ port: number; close: () => Promise<void> }> {
    return new Promise((resolve) => {
      const http = serve({ fetch: app.fetch, port }, (info: AddressInfo) => {
        resolve({ port: info.port, close: () => new Promise((done) => sockets.close(() => done())) });
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
        socket.emit("game", view(gameId, load(gameId)!.state));
      });
    });
  }

  return { app, listen };
}
