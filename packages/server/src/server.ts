import { randomBytes, randomInt } from "node:crypto";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, asc, count, desc, eq, inArray, isNotNull, like, or, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
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
import {
  isThemeImage,
  PHOTO_KEEP_DAYS,
  PHOTO_MAX_BYTES,
  photoStore,
  preparePhoto,
  prepareThemeImage,
  themeStore,
  type ThemeImage,
} from "./photos.js";
import { zip } from "./zip.js";
import { gameEvents, gameHosts, gamePlayers, games, openDb, organizations, posts, sessions, signInLinks, turnClocks, users, votes, type Tx } from "./db.js";
import {
  cohostBody,
  command,
  createGameBody,
  feedbackBody,
  gameOptionsEdit,
  gameOrgBody,
  gameThemeEdit,
  joinBody,
  linkRedemption,
  linkRequest,
  moderationBody,
  orgBody,
  orgEdit,
  postBody,
  postStatusBody,
  timerBody,
  voteBody,
  voteDisplayBody,
  voteStatusBody,
} from "./schemas.js";

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
   * True when a reverse proxy (ww-edge's Caddy on the droplet) sits in front and sets X-Forwarded-For. Only then is
   * that header believed: otherwise a client could forge it to dodge the per-IP limit.
   */
  trustProxy?: boolean;
  /**
   * The built web app (packages/web/dist), served by this server in production. Left out in development,
   * where Vite serves the app and passes /api through.
   */
  webRoot?: string;
  /** Where Photos are stored. Left out (as in most tests), they go to a fresh temporary folder. */
  photosDir?: string;
  /** Where Theme logos and backgrounds are stored; likewise a temporary folder if left out. */
  themesDir?: string;
  /** Who may use the admin pages (from ADMIN_EMAILS). Left out, there are none and those pages don't exist. */
  adminEmails?: readonly string[];
}

const randomDraw: DrawFn = (candidates) => candidates[randomInt(candidates.length)]!;

/** A Game as the server holds it: what's stored alongside the log, its state rebuilt from the log, and the log's length. */
interface LoadedGame {
  name: string;
  rosterMode: "host" | "self";
  moderation: "open" | "approval" | "paused";
  turnSeconds: number;
  /** When each Player who's up was called up, or had their timer reset (ms since 1970). */
  clocks: ReadonlyMap<string, number>;
  state: GameState;
  seq: number;
  theme: {
    /** The Organization the Game shows the Theme of, with that Theme as it stands. */
    org: OrgTheme | null;
    /** The Game's own parts, which win over the Organization's. */
    own: ThemeParts;
  };
  vote: {
    status: "none" | "open" | "closed";
    display: "live" | "hidden" | "parade";
    winner: string | null;
    /** Each voter's Gift, by email. Never sent as is: screens get counts, and each person their own vote. */
    ballots: ReadonlyMap<string, string>;
  };
}

/** A Theme's parts, each null when unset: colors as "#rrggbb", images as the version of the stored file. */
interface ThemeParts {
  color: string | null;
  page: string | null;
  logo: string | null;
  background: string | null;
}
type OrgTheme = ThemeParts & { id: string; name: string };

/**
 * The Theme a Game is shown with: each part from the Game's own override, else its Organization's, else unset
 * (the app's own look). Images are given as addresses that change with each upload, so they can be cached for good.
 */
function resolveTheme(gameId: string, { org, own }: LoadedGame["theme"]) {
  const image = (kind: "logo" | "background") =>
    own[kind]
      ? `/api/games/${gameId}/theme/${kind}?v=${own[kind]}`
      : org?.[kind]
        ? `/api/orgs/${org.id}/${kind}?v=${org[kind]}`
        : null;
  return {
    organization: org ? { id: org.id, name: org.name } : null,
    color: own.color ?? org?.color ?? null,
    page: own.page ?? org?.page ?? null,
    logoUrl: image("logo"),
    backgroundUrl: image("background"),
    /** Which parts are the Game's own rather than its Organization's. */
    overrides: { color: own.color !== null, page: own.page !== null, logo: own.logo !== null, background: own.background !== null },
  };
}

/** How many votes each Gift has (only Gifts with any). */
function tally(ballots: ReadonlyMap<string, string>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const giftId of ballots.values()) counts[giftId] = (counts[giftId] ?? 0) + 1;
  return counts;
}

/** What screens are shown about a Game: answers from the rules module, never its internal state. */
function view(id: string, game: LoadedGame, now: Date) {
  const { name, rosterMode, moderation, turnSeconds, clocks, state, seq, vote } = game;
  return {
    id,
    name,
    theme: resolveTheme(id, game.theme),
    rosterMode,
    moderation,
    /** The turn timer. `now` is the server's time, so a screen can count down correctly even if its own clock is off. */
    clock: { now: now.getTime(), turnSeconds, startedAt: Object.fromEntries(clocks) },
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
    /**
     * The Worst Gift Vote. How many have voted is always shown; the counts only once it's closed, or while
     * it's open under the Live display. Under Hidden or Parade they never leave the server until the reveal.
     */
    vote: {
      status: vote.status,
      display: vote.display,
      cast: vote.ballots.size,
      counts: vote.status === "closed" || (vote.status === "open" && vote.display === "live") ? tally(vote.ballots) : null,
      winner: vote.winner,
    },
  };
}

/** A name made safe for a file name: letters, digits and single dashes. */
const fileSafe = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

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
  photosDir,
  themesDir,
  limits = {},
  trustProxy = false,
  webRoot,
  adminEmails = [],
}: ServerOptions) {
  const db = openDb(dbPath);
  const photos = photoStore(photosDir ?? mkdtempSync(join(tmpdir(), "elephant-photos-")));
  const themeImages = themeStore(themesDir ?? mkdtempSync(join(tmpdir(), "elephant-themes-")));
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
    const clocks = db.select().from(turnClocks).where(eq(turnClocks.gameId, id)).all();
    const ballots = db.select().from(votes).where(eq(votes.gameId, id)).all();
    const game: LoadedGame = {
      theme: {
        org: row.orgId ? orgTheme(row.orgId) : null,
        own: { color: row.themeColor, page: row.themePage, logo: row.themeLogo, background: row.themeBackground },
      },
      vote: {
        status: row.voteStatus,
        display: row.voteDisplay,
        winner: row.voteWinner,
        ballots: new Map(ballots.map((b) => [b.email, b.giftId])),
      },
      name: row.name,
      rosterMode: row.rosterMode,
      moderation: row.moderation,
      turnSeconds: row.turnSeconds,
      clocks: new Map(clocks.map((c) => [c.playerId, c.startedAt.getTime()])),
      state,
      seq: log.length,
    };
    cache.set(id, game);
    return game;
  }

  /** An Organization's Theme as it stands, with its id and name; null if there's no such Organization. */
  function orgTheme(orgId: string): OrgTheme | null {
    const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
    return org ? { id: org.id, name: org.name, color: org.color, page: org.page, logo: org.logo, background: org.background } : null;
  }

  /** Whether this person may give a Game this Organization's Theme: only its Organizer may. */
  const organizes = (orgId: string, email: string) =>
    db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.id, orgId), eq(organizations.organizerEmail, email))).get() !== undefined;

  /** After an Organizer changes their Organization, brings every Game showing it up to date on every screen. */
  function orgChanged(orgId: string) {
    const org = orgTheme(orgId);
    for (const { id } of db.select({ id: games.id }).from(games).where(eq(games.orgId, orgId)).all()) {
      const game = cache.get(id);
      if (game) publish(id, { ...game, theme: { ...game.theme, org } });
    }
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
    const state = result.reduce(evolve, game.state);
    // A Player's clock starts when they're called up (a Victim's too) and goes once they're no longer up.
    const clocks = new Map<string, number>();
    for (const playerId of activePlayers(state)) clocks.set(playerId, game.clocks.get(playerId) ?? at.getTime());
    db.transaction((tx) => {
      result.forEach((event, i) => {
        tx.insert(gameEvents).values({ gameId: id, seq: game.seq + i + 1, event: JSON.stringify(event), createdAt: at }).run();
      });
      tx.delete(turnClocks).where(eq(turnClocks.gameId, id)).run();
      for (const [playerId, ms] of clocks) tx.insert(turnClocks).values({ gameId: id, playerId, startedAt: new Date(ms) }).run();
      alsoWrite?.(tx);
    });
    return publish(id, { ...game, clocks, state, seq: game.seq + result.length });
  }

  /** Tells every screen watching that the Feed changed. Each asks for it again, since each may see different Posts. */
  function postsChanged(id: string) {
    io?.to(id).emit("posts");
  }

  /** Keeps the Game's new copy and sends it to every screen watching. */
  function publish(id: string, next: LoadedGame) {
    cache.set(id, next);
    const shown = view(id, next, now());
    io?.to(id).emit("game", shown);
    return shown;
  }

  /** Set once listening: every screen watching a Game sits in a room named by the Game's id. */
  let io: SocketServer | undefined;

  const app = new Hono();

  // For Docker's HEALTHCHECK and uptime monitors: up only if the database answers.
  app.get("/api/health", (c) => {
    c.header("Cache-Control", "no-store");
    try {
      db.$client.prepare("select 1").get();
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });

  // Always 202, whether or not the address has been seen before, so this can't be used to find out who has an account.
  app.post("/api/auth/link", async (c) => {
    const body = await parseBody(c, linkRequest);
    if (!body.ok) return body.res;
    const token = auth.issueLink(body.data.email, clientIp(c), body.data.feedbackOk);
    if (!token) return c.json({ error: "Too many sign-in links asked for; try again in a few minutes" }, 429);
    // Someone who scanned a Game's QR code goes back to that Game once signed in.
    const next = body.data.next ? `&next=${encodeURIComponent(body.data.next)}` : "";
    // The link opens the web app's sign-in page, which redeems it with a POST. A GET that signed people in
    // would be used up by email scanners (such as Outlook Safe Links) that open every link to check it.
    try {
      await mailer.sendSignInLink(body.data.email, `${baseUrl}/sign-in?token=${token}${next}`);
    } catch (err) {
      // Such as Resend's daily limit. Say so, rather than leave someone waiting for an email that isn't coming.
      console.error("Couldn't send a sign-in link", err);
      return c.json({ error: "We couldn't send the email just now; please try again in a minute" }, 503);
    }
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
    const feedbackOk = db.select({ ok: users.feedbackOk }).from(users).where(eq(users.email, email)).get()?.ok ?? false;
    return c.json({ email, feedbackOk, admin: isAdmin(email) });
  });

  /** Whether it's OK to email the signed-in person to ask how it went. */
  app.post("/api/me/feedback", async (c) => {
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, feedbackBody);
    if (!body.ok) return body.res;
    db.update(users).set({ feedbackOk: body.data.ok }).where(eq(users.email, email)).run();
    return c.body(null, 204);
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
    const { orgId } = body.data;
    if (orgId !== undefined && !organizes(orgId, email)) return c.json({ error: "Only an Organization's Organizer can use its Theme" }, 403);
    // 16 random bytes: unguessable, so a Game can't be found without its link or QR code.
    const id = randomBytes(16).toString("base64url");
    db.transaction((tx) => {
      tx.insert(games)
        .values({
          id,
          name: body.data.name,
          rosterMode: body.data.rosterMode,
          turnSeconds: body.data.turnSeconds,
          orgId: orgId ?? null,
          demo: body.data.demo,
          settings: JSON.stringify(body.data.settings),
          createdAt: now(),
        })
        .run();
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
    return c.json({
      ...view(id, game, now()),
      role: (email && roleIn(id, email)) ?? null,
      me: playerId ? { playerId } : null,
      myVote: (email && game.vote.ballots.get(email)) ?? null,
    });
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

  // The Host restarts a Player's countdown, say after explaining the rules. Not a Pick: it isn't logged or undone.
  app.post("/api/games/:id/timer", async (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, timerBody);
    if (!body.ok) return body.res;
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (!roleIn(id, email)) return c.json({ error: "Only the Host and Co-hosts can run this Game" }, 403);
    const { playerId } = body.data;
    if (!game.clocks.has(playerId)) return c.json({ code: "NotActive", message: "That Player isn't up" }, 409);

    const at = now();
    db.update(turnClocks)
      .set({ startedAt: at })
      .where(and(eq(turnClocks.gameId, id), eq(turnClocks.playerId, playerId)))
      .run();
    // The version doesn't change, since the Game didn't: screens take a copy at the same version as the newer one.
    return c.json(publish(id, { ...game, clocks: new Map(game.clocks).set(playerId, at.getTime()) }));
  });

  // The Feed, as this viewer may see it: every visible Post, plus their own and, for a Host, all the others.
  app.get("/api/games/:id/posts", (c) => {
    const id = c.req.param("id");
    if (!load(id)) return c.json({ error: "Game not found" }, 404);
    const email = signedInAs(c);
    const hosting = email !== undefined && roleIn(id, email) !== undefined;
    const seen = hosting ? undefined : email ? or(eq(posts.status, "visible"), eq(posts.email, email)) : eq(posts.status, "visible");
    const rows = db
      .select()
      .from(posts)
      .where(seen ? and(eq(posts.gameId, id), seen) : eq(posts.gameId, id))
      .orderBy(desc(posts.createdAt), desc(sql`${posts}.rowid`))
      .all();
    return c.json(
      rows.map((p) => ({
        id: p.id,
        author: p.author,
        giftId: p.giftId,
        text: p.text,
        photo: p.photoWidth && p.photoHeight ? { url: `/api/games/${id}/posts/${p.id}/photo`, width: p.photoWidth, height: p.photoHeight } : null,
        status: p.status,
        createdAt: p.createdAt.getTime(),
        mine: p.email === email,
      })),
    );
  });

  // Words come as JSON; a Post with a Photo comes as a multipart form, its file in `photo`.
  const photoSizeLimit = bodyLimit({
    maxSize: PHOTO_MAX_BYTES + 64 * 1024,
    onError: (c) => c.json({ error: "That Photo is too big to send" }, 413),
  });

  app.post("/api/games/:id/posts", photoSizeLimit, async (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in to post" }, 401);
    let upload: File | undefined;
    let body: Awaited<ReturnType<typeof parseBody<z.infer<typeof postBody>>>>;
    if (c.req.header("content-type")?.startsWith("multipart/form-data")) {
      const form = await c.req.parseBody();
      const field = (k: string) => (typeof form[k] === "string" && form[k] !== "" ? form[k] : undefined);
      const file = form["photo"];
      // A file rather than a text field (checked by type, not `instanceof File`, which depends on whose File).
      upload = file !== undefined && typeof file !== "string" ? (file as File) : undefined;
      const parsed = postBody.safeParse({ text: field("text"), name: field("name"), giftId: field("giftId") });
      body = parsed.success ? { ok: true, data: parsed.data } : { ok: false, res: c.json({ error: "Invalid request", issues: parsed.error.issues }, 400) };
    } else {
      body = await parseBody(c, postBody);
    }
    if (!body.ok) return body.res;
    if (!body.data.text && !upload) return c.json({ error: "Write something or add a Photo" }, 400);
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (game.moderation === "paused") return c.json({ code: "Paused", message: "The Host has paused posting" }, 409);
    const { text, giftId } = body.data;
    if (giftId !== undefined && !gifts(game.state).some((g) => g.id === giftId)) return c.json({ error: "No such Gift in this Game" }, 400);
    // A Player posts as their Player; anyone else (a Guest) as the name they give.
    const playerId = playerOf(id, email, game);
    const author = playerId ? roster(game.state).find((p) => p.id === playerId)!.name : body.data.name;
    if (!author) return c.json({ error: "Say what name to post as" }, 400);

    const photo = upload && (await preparePhoto(new Uint8Array(await upload.arrayBuffer())));
    if (upload && !photo) return c.json({ error: "That doesn't look like a photo we can use" }, 400);

    const status = game.moderation === "approval" ? "pending" : "visible";
    const postId = randomBytes(12).toString("base64url");
    if (photo) photos.save(id, postId, photo.data);
    try {
      db.insert(posts)
        .values({
          id: postId,
          gameId: id,
          email,
          author,
          giftId: giftId ?? null,
          text,
          photoWidth: photo?.width ?? null,
          photoHeight: photo?.height ?? null,
          status,
          createdAt: now(),
        })
        .run();
    } catch (err) {
      if (photo) photos.remove(id, postId);
      throw err;
    }
    postsChanged(id);
    return c.body(null, 201);
  });

  // Every visible Photo in one zip, for the Host to keep before they're deleted (hidden ones stay out).
  app.get("/api/games/:id/album.zip", (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (!roleIn(id, email)) return c.json({ error: "Only the Host and Co-hosts can download the album" }, 403);

    const rows = db
      .select()
      .from(posts)
      .where(and(eq(posts.gameId, id), eq(posts.status, "visible"), isNotNull(posts.photoWidth)))
      .orderBy(asc(posts.createdAt), asc(sql`${posts}.rowid`))
      .all();
    const digits = Math.max(2, String(rows.length).length);
    const files: { name: string; data: Uint8Array }[] = [];
    const captions: string[] = [];
    rows.forEach((p, i) => {
      const data = photos.read(p.gameId, p.id);
      if (!data) return;
      const name = `${String(i + 1).padStart(digits, "0")}-${fileSafe(p.author) || "photo"}.jpg`;
      files.push({ name, data });
      captions.push(`${name}  ${p.author}${p.text ? `: ${p.text.replace(/\s+/g, " ")}` : ""}`);
    });
    files.push({ name: "captions.txt", data: Buffer.from(captions.join("\n") + "\n", "utf8") });

    return c.body(new Uint8Array(zip(files, now())), 200, {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${fileSafe(game.name) || "game"}-photos.zip"`,
      "cache-control": "no-store",
    });
  });

  // A Post's Photo, to whoever may see the Post: anyone if it's visible, otherwise only its poster and the Hosts.
  app.get("/api/games/:id/posts/:postId/photo", (c) => {
    const { id, postId } = c.req.param();
    const row = db.select().from(posts).where(and(eq(posts.gameId, id), eq(posts.id, postId))).get();
    const email = signedInAs(c);
    const mayView = row && (row.status === "visible" || row.email === email || (email !== undefined && roleIn(id, email) !== undefined));
    const data = mayView && row.photoWidth ? photos.read(row.gameId, row.id) : undefined;
    if (!data) return c.json({ error: "No such Photo" }, 404);
    // Private: a Photo shown to one person (a Pending one, say) mustn't be kept by a cache shared with others.
    return c.body(new Uint8Array(data), 200, { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" });
  });

  // Organizations: anyone signed in may create one, and is then its Organizer, the only one who can change it.
  const orgView = (o: OrgTheme) => ({
    id: o.id,
    name: o.name,
    color: o.color,
    page: o.page,
    logoUrl: o.logo ? `/api/orgs/${o.id}/logo?v=${o.logo}` : null,
    backgroundUrl: o.background ? `/api/orgs/${o.id}/background?v=${o.background}` : null,
  });

  app.post("/api/orgs", async (c) => {
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, orgBody);
    if (!body.ok) return body.res;
    const id = randomBytes(12).toString("base64url");
    db.insert(organizations).values({ id, name: body.data.name, organizerEmail: email, createdAt: now() }).run();
    return c.json({ id }, 201);
  });

  /** The Organizations the signed-in person is the Organizer of, oldest first. */
  app.get("/api/orgs", (c) => {
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const rows = db.select().from(organizations).where(eq(organizations.organizerEmail, email)).orderBy(asc(organizations.createdAt), asc(sql`${organizations}.rowid`)).all();
    return c.json(rows.map((o) => orgView(o)));
  });

  app.patch("/api/orgs/:orgId", async (c) => {
    const orgId = c.req.param("orgId");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, orgEdit);
    if (!body.ok) return body.res;
    if (!orgTheme(orgId)) return c.json({ error: "No such Organization" }, 404);
    if (!organizes(orgId, email)) return c.json({ error: "Only its Organizer can change an Organization" }, 403);
    if (Object.keys(body.data).length > 0) db.update(organizations).set(body.data).where(eq(organizations.id, orgId)).run();
    orgChanged(orgId);
    return c.json(orgView(orgTheme(orgId)!));
  });

  /** The file in a multipart upload's `image` field (checked by type, not `instanceof File`: see the Photo upload). */
  async function uploadedImage(c: Context): Promise<Uint8Array | undefined> {
    if (!c.req.header("content-type")?.startsWith("multipart/form-data")) return undefined;
    const file = (await c.req.parseBody())["image"];
    return file !== undefined && typeof file !== "string" ? new Uint8Array(await (file as File).arrayBuffer()) : undefined;
  }

  /** Serves a Theme image at its versioned address: cached for good, since a new upload gets a new address. */
  function themeImage(c: Context, owner: string, kind: ThemeImage, version: string | null | undefined) {
    const data = version ? themeImages.read(owner, kind) : undefined;
    if (!data) return c.json({ error: "No such image" }, 404);
    return c.body(new Uint8Array(data), 200, { "content-type": "image/webp", "cache-control": "public, max-age=31536000, immutable" });
  }

  /**
   * Stores (PUT) or removes (DELETE) a Theme image, returning its new version (null once removed), or the
   * response to send instead if the upload isn't an image.
   */
  async function changeThemeImage(c: Context, method: "put" | "delete", owner: string, kind: ThemeImage): Promise<{ version: string | null } | Response> {
    if (method === "delete") {
      themeImages.remove(owner, kind);
      return { version: null };
    }
    const input = await uploadedImage(c);
    const image = input && (await prepareThemeImage(input, kind));
    if (!image) return c.json({ error: "That doesn't look like an image we can use" }, 400);
    themeImages.save(owner, kind, image);
    return { version: randomBytes(6).toString("base64url") };
  }

  app.get("/api/orgs/:orgId/:kind", (c) => {
    const { orgId, kind } = c.req.param();
    if (!isThemeImage(kind)) return c.json({ error: "Not found" }, 404);
    return themeImage(c, `org-${orgId}`, kind, orgTheme(orgId)?.[kind]);
  });

  // The Organizer sets (PUT) or removes (DELETE) the Organization's logo or background.
  for (const method of ["put", "delete"] as const) {
    app.on(method.toUpperCase(), "/api/orgs/:orgId/:kind", photoSizeLimit, async (c) => {
      const { orgId, kind } = c.req.param();
      const email = signedInAs(c);
      if (!email) return c.json({ error: "Sign in first" }, 401);
      if (!isThemeImage(kind) || !orgTheme(orgId)) return c.json({ error: "Not found" }, 404);
      if (!organizes(orgId, email)) return c.json({ error: "Only its Organizer can change an Organization" }, 403);
      const changed = await changeThemeImage(c, method, `org-${orgId}`, kind);
      if (changed instanceof Response) return changed;
      db.update(organizations).set({ [kind]: changed.version }).where(eq(organizations.id, orgId)).run();
      orgChanged(orgId);
      return c.json(orgView(orgTheme(orgId)!));
    });
  }

  app.get("/api/games/:id/theme/:kind", (c) => {
    const { id, kind } = c.req.param();
    if (!isThemeImage(kind)) return c.json({ error: "Not found" }, 404);
    return themeImage(c, `game-${id}`, kind, load(id)?.theme.own[kind]);
  });

  // The Host or a Co-host sets or removes the Game's own logo or background, overriding the Organization's.
  for (const method of ["put", "delete"] as const) {
    app.on(method.toUpperCase(), "/api/games/:id/theme/:kind", photoSizeLimit, async (c) => {
      const { id, kind } = c.req.param();
      const email = signedInAs(c);
      if (!email) return c.json({ error: "Sign in first" }, 401);
      const game = load(id);
      if (!isThemeImage(kind) || !game) return c.json({ error: "Not found" }, 404);
      if (!roleIn(id, email)) return c.json({ error: "Only the Host and Co-hosts can change the Game's look" }, 403);
      const changed = await changeThemeImage(c, method, `game-${id}`, kind);
      if (changed instanceof Response) return changed;
      db.update(games)
        .set(kind === "logo" ? { themeLogo: changed.version } : { themeBackground: changed.version })
        .where(eq(games.id, id))
        .run();
      return c.json(publish(id, { ...game, theme: { ...game.theme, own: { ...game.theme.own, [kind]: changed.version } } }).theme);
    });
  }

  // Which Organization's Theme a Game shows: the Host or a Co-host picks one they're the Organizer of, or none.
  app.post("/api/games/:id/org", async (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, gameOrgBody);
    if (!body.ok) return body.res;
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (!roleIn(id, email)) return c.json({ error: "Only the Host and Co-hosts can change the Game's look" }, 403);
    const { orgId } = body.data;
    if (orgId !== null && !organizes(orgId, email)) return c.json({ error: "Only an Organization's Organizer can use its Theme" }, 403);
    db.update(games).set({ orgId }).where(eq(games.id, id)).run();
    publish(id, { ...game, theme: { ...game.theme, org: orgId ? orgTheme(orgId) : null } });
    return c.body(null, 204);
  });

  // The Game's own Theme, overriding its Organization's part by part (null hands a part back to it).
  /** The Host or a Co-host changes the Game's name, turn timer or who adds the Players; every screen updates. */
  app.patch("/api/games/:id/options", async (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, gameOptionsEdit);
    if (!body.ok) return body.res;
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (!roleIn(id, email)) return c.json({ error: "Only the Host and Co-hosts can change this Game" }, 403);
    const { name, turnSeconds, rosterMode } = body.data;
    const set = {
      ...(name !== undefined ? { name } : {}),
      ...(turnSeconds !== undefined ? { turnSeconds } : {}),
      ...(rosterMode !== undefined ? { rosterMode } : {}),
    };
    if (Object.keys(set).length > 0) db.update(games).set(set).where(eq(games.id, id)).run();
    return c.json(publish(id, { ...game, ...set }));
  });

  app.patch("/api/games/:id/theme", async (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, gameThemeEdit);
    if (!body.ok) return body.res;
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (!roleIn(id, email)) return c.json({ error: "Only the Host and Co-hosts can change the Game's look" }, 403);
    const { color, page } = body.data;
    const set = { ...(color !== undefined ? { themeColor: color } : {}), ...(page !== undefined ? { themePage: page } : {}) };
    if (Object.keys(set).length > 0) db.update(games).set(set).where(eq(games.id, id)).run();
    const own = { ...game.theme.own, ...(color !== undefined ? { color } : {}), ...(page !== undefined ? { page } : {}) };
    return c.json(publish(id, { ...game, theme: { ...game.theme, own } }).theme);
  });

  // The Host or a Co-host opens the Worst Gift Vote once the Game has ended, and closes it to reveal the results.
  app.post("/api/games/:id/vote/status", async (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, voteStatusBody);
    if (!body.ok) return body.res;
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (!roleIn(id, email)) return c.json({ error: "Only the Host and Co-hosts can run the vote" }, 403);

    if (body.data.status === "open") {
      if (phase(game.state) !== "ended") return c.json({ code: "GameNotOver", message: "End the Game before the vote" }, 409);
      db.update(games).set({ voteStatus: "open", voteWinner: null }).where(eq(games.id, id)).run();
      publish(id, { ...game, vote: { ...game.vote, status: "open", winner: null } });
      return c.body(null, 204);
    }

    if (game.vote.status !== "open") return c.json({ code: "VoteNotOpen", message: "The vote isn't open" }, 409);
    const counts = tally(game.vote.ballots);
    const most = Math.max(0, ...Object.values(counts));
    // In the order the Gifts were opened, so the Host sees them as they remember them.
    const tied = most === 0 ? [] : gifts(game.state).map((g) => g.id).filter((g) => counts[g] === most);
    const picked = body.data.winner;
    if (picked !== undefined && !tied.includes(picked)) return c.json({ error: "That Gift isn't one with the most votes" }, 400);
    if (tied.length > 1 && picked === undefined) {
      return c.json({ code: "Tie", message: "Gifts are tied for most votes: pick the winner", tied }, 409);
    }
    const winner = picked ?? tied[0] ?? null;
    db.update(games).set({ voteStatus: "closed", voteWinner: winner }).where(eq(games.id, id)).run();
    publish(id, { ...game, vote: { ...game.vote, status: "closed", winner } });
    return c.body(null, 204);
  });

  app.post("/api/games/:id/vote/display", async (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, voteDisplayBody);
    if (!body.ok) return body.res;
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (!roleIn(id, email)) return c.json({ error: "Only the Host and Co-hosts can run the vote" }, 403);
    db.update(games).set({ voteDisplay: body.data.display }).where(eq(games.id, id)).run();
    publish(id, { ...game, vote: { ...game.vote, display: body.data.display } });
    return c.body(null, 204);
  });

  // Casting or moving this person's one vote.
  app.post("/api/games/:id/vote", async (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in to vote" }, 401);
    const body = await parseBody(c, voteBody);
    if (!body.ok) return body.res;
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (game.vote.status !== "open") return c.json({ code: "VoteNotOpen", message: "The vote isn't open" }, 409);
    const { giftId } = body.data;
    if (!gifts(game.state).some((g) => g.id === giftId)) return c.json({ error: "No such Gift in this Game" }, 400);

    db.insert(votes)
      .values({ gameId: id, email, giftId })
      .onConflictDoUpdate({ target: [votes.gameId, votes.email], set: { giftId } })
      .run();
    publish(id, { ...game, vote: { ...game.vote, ballots: new Map(game.vote.ballots).set(email, giftId) } });
    return c.json({ myVote: giftId });
  });

  app.post("/api/games/:id/moderation", async (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, moderationBody);
    if (!body.ok) return body.res;
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (!roleIn(id, email)) return c.json({ error: "Only the Host and Co-hosts can moderate this Game" }, 403);
    db.update(games).set({ moderation: body.data.mode }).where(eq(games.id, id)).run();
    publish(id, { ...game, moderation: body.data.mode });
    return c.body(null, 204);
  });

  // Approving a Pending Post and showing a Hidden one again are the same: it becomes visible.
  app.post("/api/games/:id/posts/:postId/status", async (c) => {
    const { id, postId } = c.req.param();
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, postStatusBody);
    if (!body.ok) return body.res;
    if (!load(id)) return c.json({ error: "Game not found" }, 404);
    if (!roleIn(id, email)) return c.json({ error: "Only the Host and Co-hosts can moderate this Game" }, 403);
    const changed = db
      .update(posts)
      .set({ status: body.data.status })
      .where(and(eq(posts.gameId, id), eq(posts.id, postId)))
      .run();
    if (changed.changes === 0) return c.json({ error: "Post not found" }, 404);
    postsChanged(id);
    return c.body(null, 204);
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

  // The admin pages: only for ADMIN_EMAILS. To anyone else they answer 404, as if they weren't there.
  const admins = new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  function isAdmin(email: string | undefined): boolean {
    return email !== undefined && admins.has(email.toLowerCase());
  }
  app.use("/api/admin/*", async (c, next) => {
    if (!isAdmin(signedInAs(c))) return c.json({ error: "Not found" }, 404);
    await next();
  });

  /** Everyone who has signed in, newest first: when, whether a feedback email is OK, and what they've made. */
  app.get("/api/admin/people", (c) => {
    const hosted = db
      .select({ email: gameHosts.email, demo: games.demo, n: count() })
      .from(gameHosts)
      .innerJoin(games, eq(games.id, gameHosts.gameId))
      .where(eq(gameHosts.role, "host"))
      .groupBy(gameHosts.email, games.demo)
      .all();
    const orgs = db.select({ email: organizations.organizerEmail, name: organizations.name }).from(organizations).orderBy(asc(organizations.createdAt)).all();
    const people = db.select().from(users).orderBy(desc(users.createdAt)).all();
    return c.json(
      people.map((u) => ({
        email: u.email,
        firstSeen: u.createdAt.toISOString(),
        lastSignIn: u.lastSignInAt?.toISOString() ?? null,
        feedbackOk: u.feedbackOk,
        games: hosted.find((h) => h.email === u.email && !h.demo)?.n ?? 0,
        demoGames: hosted.find((h) => h.email === u.email && h.demo)?.n ?? 0,
        organizations: orgs.filter((o) => o.email === u.email).map((o) => o.name),
      })),
    );
  });

  /** Every Game, newest first, with its Host and how far along it is. */
  app.get("/api/admin/games", (c) => {
    const rows = db
      .select({ id: games.id, demo: games.demo, createdAt: games.createdAt, host: gameHosts.email })
      .from(games)
      .leftJoin(gameHosts, and(eq(gameHosts.gameId, games.id), eq(gameHosts.role, "host")))
      .orderBy(desc(games.createdAt), desc(sql`${games}.rowid`))
      .all();
    return c.json(
      rows.map((r) => {
        const game = load(r.id)!;
        return {
          id: r.id,
          name: game.name,
          demo: r.demo,
          host: r.host ?? "",
          phase: phase(game.state),
          players: roster(game.state).length,
          createdAt: r.createdAt.toISOString(),
        };
      }),
    );
  });

  /** Removes a Game and everything kept for it: its log, Hosts, Players, Posts and their Photos, votes, Theme images. */
  function deleteGame(id: string) {
    db.transaction((tx) => {
      for (const table of [votes, posts, turnClocks, gamePlayers, gameHosts, gameEvents]) tx.delete(table).where(eq(table.gameId, id)).run();
      tx.delete(games).where(eq(games.id, id)).run();
    });
    cache.delete(id);
    photos.removeGame(id);
    for (const kind of ["logo", "background"] as const) themeImages.remove(`game-${id}`, kind);
  }

  app.delete("/api/admin/games/:id", (c) => {
    const id = c.req.param("id");
    if (!db.select({ id: games.id }).from(games).where(eq(games.id, id)).get()) return c.json({ error: "No such Game" }, 404);
    deleteGame(id);
    return c.body(null, 204);
  });

  /**
   * Clears out what the smoke test leaves behind: everyone with an @example.com address (a domain nobody can
   * really have), the Games they host and the Organizations they run. Games of anyone else are kept.
   */
  app.post("/api/admin/test-data/delete", (c) => {
    const testers = like(sql`lower(${users.email})`, "%@example.com");
    const people = db.select({ id: users.id, email: users.email }).from(users).where(testers).all();
    const emails = people.map((p) => p.email);
    const testGames = emails.length
      ? db.selectDistinct({ id: gameHosts.gameId }).from(gameHosts).where(and(eq(gameHosts.role, "host"), inArray(gameHosts.email, emails))).all()
      : [];
    for (const { id } of testGames) deleteGame(id);
    const testOrgs = emails.length ? db.select({ id: organizations.id }).from(organizations).where(inArray(organizations.organizerEmail, emails)).all() : [];
    db.transaction((tx) => {
      for (const { id } of testOrgs) {
        tx.update(games).set({ orgId: null }).where(eq(games.orgId, id)).run();
        tx.delete(organizations).where(eq(organizations.id, id)).run();
      }
      if (people.length) {
        tx.delete(sessions).where(inArray(sessions.userId, people.map((p) => p.id))).run();
        tx.delete(signInLinks).where(inArray(signInLinks.email, emails)).run();
        tx.delete(users).where(inArray(users.id, people.map((p) => p.id))).run();
      }
    });
    for (const { id } of testOrgs) for (const kind of ["logo", "background"] as const) themeImages.remove(`org-${id}`, kind);
    // Games that showed a removed Organization's Theme are rebuilt without it.
    cache.clear();
    return c.json({ people: people.length, games: testGames.length, organizations: testOrgs.length });
  });

  // Anything else under /api is a mistake, never a page of the app.
  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  if (webRoot) {
    // Build files have the content's hash in their names, so a browser may keep them for good.
    app.use("/assets/*", async (c, next) => {
      await next();
      if (c.res.status === 200) c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    });
    app.use("/assets/*", serveStatic({ root: webRoot }));
    app.get("/assets/*", (c) => c.notFound());
    // Other files in the build (the icon, say), but not the page itself, which is served below.
    app.use("*", serveStatic({ root: webRoot, rewriteRequestPath: (path) => (path === "/" || path === "/index.html" ? "/-" : path) }));
    // Every other address is one of the app's own (a Game's link, the sign-in page): the app works out which.
    // Never cached, since it names the current build's files.
    const page = readFileSync(join(webRoot, "index.html"), "utf8");
    app.get("*", (c) => {
      c.header("Cache-Control", "no-cache");
      return c.html(page);
    });
  }

  /**
   * Deletes the Photos of every Game whose last move was PHOTO_KEEP_DAYS ago or more. A Post that was only a
   * Photo goes with it; one with words keeps them. Files go first, so a failure never leaves a Photo behind
   * that the database has forgotten. Returns how many Photos were deleted.
   */
  function sweepPhotos(): number {
    const cutoff = now().getTime() - PHOTO_KEEP_DAYS * 24 * 60 * 60_000;
    const withPhotos = db.selectDistinct({ gameId: posts.gameId }).from(posts).where(isNotNull(posts.photoWidth)).all();
    let deleted = 0;
    for (const { gameId } of withPhotos) {
      const lastMove =
        db.select({ at: sql<number | null>`max(${gameEvents.createdAt})` }).from(gameEvents).where(eq(gameEvents.gameId, gameId)).get()?.at ??
        db.select({ at: sql<number>`${games.createdAt}` }).from(games).where(eq(games.id, gameId)).get()!.at;
      if (lastMove > cutoff) continue;

      photos.removeGame(gameId);
      const photoPosts = and(eq(posts.gameId, gameId), isNotNull(posts.photoWidth));
      deleted += db.transaction((tx) => {
        const count = tx.select({ n: sql<number>`count(*)` }).from(posts).where(photoPosts).get()!.n;
        tx.delete(posts).where(and(photoPosts, eq(posts.text, ""))).run();
        tx.update(posts).set({ photoWidth: null, photoHeight: null }).where(photoPosts).run();
        return count;
      });
      postsChanged(gameId);
    }
    return deleted;
  }

  /** Clears out what's kept only for a while: old sign-in records, and Photos past their time. */
  function sweep() {
    return { ...auth.sweep(), photos: sweepPhotos() };
  }

  /** Serves HTTP and live updates on one port (0 picks a free one). Screens only listen; moves go over HTTP. */
  function listen(port: number): Promise<{ port: number; close: () => Promise<void> }> {
    sweep();
    const sweeping = setInterval(() => sweep(), 60 * 60_000);
    sweeping.unref(); // never what keeps the process alive
    return new Promise((resolve) => {
      const http = serve({ fetch: app.fetch, port }, (info: AddressInfo) => {
        resolve({
          port: info.port,
          // Stops taking requests, then closes the database, which folds SQLite's side file (-wal) back into it.
          close: async () => {
            clearInterval(sweeping);
            await new Promise<void>((done) => sockets.close(() => done()));
            db.$client.close();
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
        socket.emit("game", view(gameId, load(gameId)!, now()));
        socket.emit("posts"); // the Feed may have changed while this screen was asleep
      });
    });
  }

  return { app, listen, sweep };
}
