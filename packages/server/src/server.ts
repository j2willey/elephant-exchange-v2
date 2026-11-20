import { createHash, randomBytes, randomInt } from "node:crypto";
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
import { cleanRef, createStats } from "./stats.js";
import { createFeedback } from "./feedback.js";
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
import { gameEvents, gameHosts, gameNames, gamePlayers, games, gameVisitors, openDb, organizations, postReactions, posts, sessions, signInLinks, turnClocks, users, votes, type Tx } from "./db.js";
import {
  cohostBody,
  command,
  createGameBody,
  feedbackBody,
  publishBody,
  gameOptions,
  gameOptionsEdit,
  gameOrgBody,
  gameThemeEdit,
  joinBody,
  linkRedemption,
  linkRequest,
  visitBody,
  excludeBody,
  featureBody,
  answerBody,
  suggestionBody,
  moderationBody,
  orgBody,
  orgEdit,
  postBody,
  postStatusBody,
  personBody,
  reactionBody,
  REACTIONS,
  timerBody,
  voteBody,
  voteDisplayBody,
  screenModeBody,
  voteStatusBody,
  renameBody,
  approveNameBody,
  muteBody,
  postGiftBody,
} from "./schemas.js";

export type { Mailer } from "./auth.js";

const SESSION_COOKIE = "session";
/** Names the made-up Player a demo page's sample phone is (see the middleware on /api/games/:id/*). */
const DEMO_PLAYER_HEADER = "x-demo-player";
/** The stand-in "email" a made-up Player acts under: not an address, so nothing is ever sent to it. */
const DEMO_ACTOR = "demo-player:";

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
  /** Made with "Try a demo game": its Host console offers the demo view. */
  demo: boolean;
  rosterMode: "host" | "self";
  moderation: "open" | "approval" | "paused";
  approveNames: boolean;
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
  /** What the big screen shows: the Gift board, the rules, the join code, or the catalog. */
  screen: "gifts" | "rules" | "qr" | "catalog";
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
  const { name, demo, rosterMode, moderation, approveNames, turnSeconds, clocks, state, seq, vote, screen } = game;
  return {
    id,
    name,
    demo,
    theme: resolveTheme(id, game.theme),
    rosterMode,
    moderation,
    approveNames,
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
    /** What the big screen shows: the Gift board, the rules, the join code, or the catalog. */
    screen,
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
  const linkLimits = { ...DEFAULT_LIMITS, ...limits };
  const auth = createAuth(db, now, linkLimits);
  const stats = createStats(db, now);
  const said = createFeedback(db, now, stats.keyOf);

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
  /** Requests from a demo Game's sample phone, and the made-up Player's stand-in email each one acts as. */
  const demoActors = new WeakMap<Context, string>();
  /** Who is asking: the signed-in person, or the made-up Player a demo page's sample phone is. */
  const signedInAs = (c: Context) => demoActors.get(c) ?? auth.sessionEmail(getCookie(c, SESSION_COOKIE));
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
      screen: row.screenMode,
      vote: {
        status: row.voteStatus,
        display: row.voteDisplay,
        winner: row.voteWinner,
        ballots: new Map(ballots.map((b) => [b.email, b.giftId])),
      },
      name: row.name,
      demo: row.demo,
      rosterMode: row.rosterMode,
      moderation: row.moderation,
      approveNames: row.approveNames,
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
  /** A demo Player's stand-in email: "fay@example.com", or "fay2@example.com" when there's already a Fay. */
  function demoEmail(gameId: string, name: string): string {
    const base = name.toLowerCase().replace(/[^a-z0-9]/g, "") || "player";
    const taken = new Set(
      db
        .select({ email: gamePlayers.email })
        .from(gamePlayers)
        .where(eq(gamePlayers.gameId, gameId))
        .all()
        .map((r) => r.email),
    );
    for (let n = 1; ; n++) {
      const email = `${base}${n === 1 ? "" : n}@example.com`;
      if (!taken.has(email)) return email;
    }
  }

  /** The person behind a Player who signed up themselves; none for a Player the Host typed in. */
  function emailOfPlayer(gameId: string, playerId: string): string | undefined {
    return db
      .select({ email: gamePlayers.email })
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, playerId)))
      .get()?.email;
  }

  function nameRow(gameId: string, email: string) {
    return db
      .select()
      .from(gameNames)
      .where(and(eq(gameNames.gameId, gameId), eq(gameNames.email, email)))
      .get();
  }

  /** The name someone goes by in a Game (a Player's roster name, or a Guest's), and whether it's locked. */
  function nameIn(gameId: string, email: string, game: LoadedGame): { name: string | null; locked: boolean; pending: string | null } {
    const playerId = playerOf(gameId, email, game);
    const row = nameRow(gameId, email);
    const name = playerId ? (roster(game.state).find((p) => p.id === playerId)?.name ?? null) : (row?.name ?? null);
    return { name, locked: row?.locked ?? false, pending: row?.pending ?? null };
  }

  /** What others see in place of a name that's waiting for approval. */
  const WAITING_PLAYER = "New player";
  const WAITING_GUEST = "Guest";

  /** Under Approve names, whether a name this person picks for themselves waits for a Host or Co-host. */
  function needsApproval(gameId: string, email: string, game: LoadedGame): boolean {
    return game.approveNames && !roleIn(gameId, email);
  }

  /** Puts the name someone asked for aside until a Host or Co-host approves it, and tells their screens. */
  function holdName(gameId: string, email: string, wants: string) {
    db.insert(gameNames)
      .values({ gameId, email, pending: wants })
      .onConflictDoUpdate({ target: [gameNames.gameId, gameNames.email], set: { pending: wants } })
      .run();
    staffChanged(gameId);
  }

  /**
   * Gives someone a new name everywhere: on the roster if they're a Player, and on every Post they've made, so an
   * unkind name doesn't linger in the Feed. `locked` (set by the Host or a Co-host) says whether its owner may change
   * it again; left out, it stays as it was.
   */
  function renamePerson(id: string, game: LoadedGame, who: { email?: string; playerId?: string }, name: string, locked?: boolean) {
    const playerId = who.playerId ?? (who.email ? playerOf(id, who.email, game) : undefined);
    const email = who.email ?? (playerId ? emailOfPlayer(id, playerId) : undefined);
    const write = (tx: Tx) => {
      if (!email) return;
      const guestName = playerId ? null : name;
      tx.insert(gameNames)
        .values({ gameId: id, email, name: guestName, locked: locked ?? false })
        .onConflictDoUpdate({ target: [gameNames.gameId, gameNames.email], set: { name: guestName, pending: null, ...(locked === undefined ? {} : { locked }) } })
        .run();
      tx.update(posts).set({ author: name }).where(and(eq(posts.gameId, id), eq(posts.email, email))).run();
    };
    if (playerId) run(id, game, { type: "RenamePlayer", playerId, name }, write);
    else db.transaction(write);
    if (email) {
      postsChanged(id);
      staffChanged(id); // it may have settled a name that was waiting
    }
  }

  function playerOf(gameId: string, email: string, game: LoadedGame): string | undefined {
    if (email.startsWith(DEMO_ACTOR)) {
      const playerId = email.slice(DEMO_ACTOR.length);
      return roster(game.state).some((p) => p.id === playerId) ? playerId : undefined;
    }
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

  // The demo page's sample phone (Demo.tsx) is one of a demo Game's made-up Players. It runs in the Host's own
  // browser, so it carries the Host's sign-in, and names the Player in a header. Only in a demo Game, only for
  // its Hosts and only for a Player on its Roster: the phone then acts as that Player, by the Player's stand-in email
  // (so, if the Host made that Player a Co-host, as a Co-host; never as the Host).
  app.use("/api/games/:id/*", async (c, next) => {
    const playerId = c.req.header(DEMO_PLAYER_HEADER);
    if (playerId === undefined) return next();
    const id = c.req.param("id")!;
    const email = auth.sessionEmail(getCookie(c, SESSION_COOKIE));
    const row = db.select({ demo: games.demo }).from(games).where(eq(games.id, id)).get();
    const game = row?.demo ? load(id) : undefined;
    if (!email || !game || !roleIn(id, email) || !roster(game.state).some((p) => p.id === playerId)) {
      return c.json({ error: "Only a demo Game's Host can see it as one of its Players" }, 403);
    }
    demoActors.set(c, emailOfPlayer(id, playerId) ?? DEMO_ACTOR + playerId);
    return next();
  });

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
    const token = auth.issueLink(body.data.email, clientIp(c), body.data.feedbackOk, cleanRef(body.data.ref));
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
    stats.countToday("signInEmails");
    return c.body(null, 202);
  });

  /** A feature only the browser sees (such as pasting the roster), used in a Game by its Host or a Co-host. */
  app.post("/api/games/:id/features", async (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, featureBody);
    if (!body.ok) return body.res;
    if (!load(id)) return c.json({ error: "Game not found" }, 404);
    if (!roleIn(id, email)) return c.json({ error: "Only the Host and Co-hosts" }, 403);
    stats.noteFeature(id, body.data.feature);
    return c.body(null, 204);
  });

  /**
   * Whether the signed-in person is asked how a Game went, and what they said. A Host or Co-host is asked once the
   * Game is over; a guest once it's over and the vote isn't under way. Never in a demo, never before the end.
   */
  function feedbackFor(id: string, email: string) {
    const game = load(id)!;
    const as = roleIn(id, email) ? ("host" as const) : ("guest" as const);
    const over = phase(game.state) === "ended" && !game.demo;
    const asked = over && (as === "host" || game.vote.status !== "open");
    return { asked, as, given: said.mine(id, email, as) };
  }

  app.get("/api/games/:id/feedback", (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    if (!load(id)) return c.json({ error: "Game not found" }, 404);
    const { asked, as, given } = feedbackFor(id, email);
    return c.json({
      asked,
      as,
      given: given && { rating: given.rating, again: given.again, thumbs: given.thumbs, comment: given.comment, quoteOk: given.quoteOk, quoteName: given.quoteName },
    });
  });

  app.post("/api/games/:id/feedback", async (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, answerBody);
    if (!body.ok) return body.res;
    if (!load(id)) return c.json({ error: "Game not found" }, 404);
    const { asked, as } = feedbackFor(id, email);
    if (!asked) return c.json({ error: "Not until the Game is over" }, 409);
    const { rating, again, thumbs, comment, quoteOk, quoteName } = body.data;
    // A Host gives stars; a guest gives thumbs.
    if (as === "host" ? rating === undefined || thumbs !== undefined : thumbs === undefined || rating !== undefined || again !== undefined) {
      return c.json({ error: as === "host" ? "Give 1 to 5 stars" : "Give a thumbs up or down" }, 400);
    }
    said.give(id, email, as, {
      ...(rating ? { rating } : {}),
      ...(again ? { again } : {}),
      ...(thumbs ? { thumbs } : {}),
      ...(comment ? { comment } : {}),
      ...(quoteOk ? { quoteOk } : {}),
      ...(quoteName ? { quoteName } : {}),
    });
    return c.body(null, 204);
  });

  /** Testimonials Jim chose for the front page: anyone may see them. */
  app.get("/api/testimonials", (c) => c.json(said.testimonials()));

  /** An idea from anyone signed in, from the home screen. */
  app.post("/api/feedback/suggestions", async (c) => {
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, suggestionBody);
    if (!body.ok) return body.res;
    said.suggest(email, body.data.comment);
    return c.body(null, 204);
  });

  /** A browser that arrived from a ?ref= link (it says so once per source): for the statistics. */
  app.post("/api/stats/visit", async (c) => {
    const body = await parseBody(c, visitBody);
    if (!body.ok) return body.res;
    const ref = cleanRef(body.data.ref);
    if (ref) stats.recordVisit(ref);
    return c.body(null, 204);
  });

  app.post("/api/auth/verify", async (c) => {
    const body = await parseBody(c, linkRedemption);
    if (!body.ok) return body.res;
    const session = auth.redeemLink(body.data.token);
    if (!session) return c.json({ error: "This sign-in link is used or expired; ask for a new one" }, 401);
    stats.recordPerson(session.email, now(), session.ref);
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
    const me = db
      .select({ feedbackOk: users.feedbackOk, tipNoteRead: users.tipNoteRead, myOptions: users.myOptions, alwaysMyOptions: users.alwaysMyOptions })
      .from(users)
      .where(eq(users.email, email))
      .get();
    const mine = me?.myOptions ? gameOptions.safeParse(JSON.parse(me.myOptions)) : null;
    return c.json({
      email,
      feedbackOk: me?.feedbackOk ?? false,
      tipNoteRead: me?.tipNoteRead ?? false,
      admin: isAdmin(email),
      myOptions: mine?.success ? mine.data : null,
      alwaysMyOptions: Boolean(mine?.success && me?.alwaysMyOptions),
    });
  });

  /** They've read and considered Jim's tip note: New Game stops showing it. Never unset. */
  app.post("/api/me/tip-note-read", (c) => {
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    db.update(users).set({ tipNoteRead: true }).where(eq(users.email, email)).run();
    return c.body(null, 204);
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
    const { rosterMode, turnSeconds, approveNames, moderation, settings, start, looked, remember } = body.data;
    const options = { ...settings, turnSeconds, rosterMode, approveNames, moderation };
    db.transaction((tx) => {
      tx.insert(games)
        .values({
          id,
          name: body.data.name,
          rosterMode,
          turnSeconds,
          approveNames,
          moderation,
          orgId: orgId ?? null,
          demo: body.data.demo,
          settings: JSON.stringify(settings),
          createdAt: now(),
        })
        .run();
      tx.insert(gameHosts).values({ gameId: id, email, role: "host" }).run();
      // The whole set is saved, so the Host's Games never change behind their back.
      if (remember === true) tx.update(users).set({ myOptions: JSON.stringify(options), alwaysMyOptions: true }).where(eq(users.email, email)).run();
      if (remember === false) tx.update(users).set({ alwaysMyOptions: false }).where(eq(users.email, email)).run();
    });
    stats.gameCreated(id, { choice: start ?? null, looked, options });
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

  /** Tells the Host's and Co-hosts' screens that who co-hosts (or plays as whom) changed. */
  function staffChanged(id: string) {
    io?.to(id).emit("staff");
  }

  /** A stable, opaque name for a person in a Game, so the Co-hosts panel never needs their email. */
  const personKey = (gameId: string, email: string) => createHash("sha256").update(`${gameId}\n${email}`).digest("base64url").slice(0, 16);
  /** Enough of an email to tell two people of the same name apart: "te…@example.com". */
  const emailHint = (email: string) => {
    const at = email.lastIndexOf("@");
    return `${email.slice(0, Math.min(2, at))}…${email.slice(at)}`;
  };

  /** Everyone signed in whom the Game knows: its Hosts, those who joined, posted, reacted or voted, or just opened it. */
  function knownPeople(id: string): Set<string> {
    const emails = new Set<string>();
    for (const table of [gameHosts, gameVisitors, gameNames, gamePlayers, posts, postReactions, votes] as const)
      for (const r of db.selectDistinct({ email: table.email }).from(table).where(eq(table.gameId, id)).all()) emails.add(r.email);
    for (const e of emails) if (e.startsWith(DEMO_ACTOR)) emails.delete(e);
    return emails;
  }

  /** The Host and Co-hosts who play in the Game, and as which Player: the one the Host named, or the one they joined as. */
  function staffOf(id: string, game: LoadedGame) {
    const inRoster = new Set(roster(game.state).map((p) => p.id));
    return db
      .select()
      .from(gameHosts)
      .where(eq(gameHosts.gameId, id))
      .all()
      .flatMap((h) => {
        const playerId = h.playerId ?? playerOf(id, h.email, game);
        return playerId && inRoster.has(playerId) ? [{ email: h.email, playerId, role: h.role }] : [];
      });
  }

  /** Everyone the Game knows, for the Host's Co-hosts panel: by name where there is one, never by email. */
  app.get("/api/games/:id/people", (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (roleIn(id, email) !== "host") return c.json({ error: "Only the Host can appoint Co-hosts" }, 403);
    const roles = new Map(db.select().from(gameHosts).where(eq(gameHosts.gameId, id)).all().map((h) => [h.email, h]));
    const names = new Map(roster(game.state).map((p) => [p.id, p.name]));
    const people = [...knownPeople(id)].map((who) => {
      const playerId = roles.get(who)?.playerId ?? playerOf(id, who, game) ?? null;
      const posted = db
        .select({ author: posts.author })
        .from(posts)
        .where(and(eq(posts.gameId, id), eq(posts.email, who)))
        .orderBy(desc(posts.createdAt))
        .get()?.author;
      return {
        key: personKey(id, who),
        name: (playerId && names.get(playerId)) || nameRow(id, who)?.name || posted || null,
        hint: emailHint(who),
        playerId,
        role: roles.get(who)?.role ?? null,
        you: who === email,
      };
    });
    // By name; those with none yet go last, by their email hint.
    people.sort((a, b) => (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) || (a.name ?? a.hint).localeCompare(b.name ?? b.hint));
    return c.json({ people });
  });

  /** The Host switches someone's Co-host role on or off, or says which Player a Host or Co-host plays as. */
  app.post("/api/games/:id/people/:key", async (c) => {
    const { id, key } = c.req.param();
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, personBody);
    if (!body.ok) return body.res;
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (roleIn(id, email) !== "host") return c.json({ error: "Only the Host can appoint Co-hosts" }, 403);
    const who = [...knownPeople(id)].find((e) => personKey(id, e) === key);
    if (!who) return c.json({ error: "Nobody like that in this Game" }, 404);
    const { cohost, playsAs } = body.data;
    const role = roleIn(id, who);
    if (role === "host" && cohost === false) return c.json({ error: "The Host is always the Host" }, 400);
    if (playsAs && !roster(game.state).some((p) => p.id === playsAs)) return c.json({ error: "No such Player in this Game" }, 400);
    const staffAfter = cohost ?? role !== undefined;
    if (playsAs !== undefined && !staffAfter) return c.json({ error: "Only a Host or Co-host plays as someone here" }, 400);

    db.transaction((tx) => {
      if (cohost === true && !role) tx.insert(gameHosts).values({ gameId: id, email: who, role: "cohost" }).run();
      if (cohost === false && role === "cohost") tx.delete(gameHosts).where(and(eq(gameHosts.gameId, id), eq(gameHosts.email, who))).run();
      if (playsAs !== undefined) tx.update(gameHosts).set({ playerId: playsAs }).where(and(eq(gameHosts.gameId, id), eq(gameHosts.email, who))).run();
    });
    staffChanged(id);
    return c.body(null, 204);
  });

  /** Which Players are the Host or a Co-host, for their consoles to mark: they may need to step in on those turns. */
  /** Under Approve names: the names people asked for, waiting for the Host or a Co-host, with what's shown meanwhile. */
  app.get("/api/games/:id/names/pending", (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (!roleIn(id, email)) return c.json({ error: "Only the Host and Co-hosts approve names" }, 403);
    const rows = db
      .select()
      .from(gameNames)
      .where(and(eq(gameNames.gameId, id), isNotNull(gameNames.pending)))
      .all();
    const pending = rows.map((r) => {
      const playerId = playerOf(id, r.email, game) ?? null;
      const shown = playerId ? (roster(game.state).find((p) => p.id === playerId)?.name ?? WAITING_PLAYER) : (r.name ?? WAITING_GUEST);
      return { key: personKey(id, r.email), shown, wants: r.pending!, playerId };
    });
    return c.json({ pending });
  });

  app.post("/api/games/:id/names/approve", async (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, approveNameBody);
    if (!body.ok) return body.res;
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (!roleIn(id, email)) return c.json({ error: "Only the Host and Co-hosts approve names" }, 403);
    const row = db
      .select()
      .from(gameNames)
      .where(and(eq(gameNames.gameId, id), isNotNull(gameNames.pending)))
      .all()
      .find((r) => personKey(id, r.email) === body.data.key);
    if (!row?.pending) return c.json({ error: "That name isn't waiting any more" }, 404);
    renamePerson(id, game, { email: row.email }, row.pending);
    return c.body(null, 204);
  });

  /** Someone changes their own name in a Game (a Player's or a Guest's), unless the Host or a Co-host locked it. */
  app.post("/api/games/:id/me/name", async (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, joinBody);
    if (!body.ok) return body.res;
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (nameRow(id, email)?.locked) return c.json({ code: "NameLocked", message: "Your Host set this name" }, 409);
    if (needsApproval(id, email, game)) {
      holdName(id, email, body.data.name);
      return c.body(null, 202); // accepted, waiting for approval
    }
    renamePerson(id, game, { email }, body.data.name);
    return c.body(null, 204);
  });

  /** The Host or a Co-host renames someone, found by their Player or one of their Posts, and locks the name or not. */
  app.post("/api/games/:id/names", async (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, renameBody);
    if (!body.ok) return body.res;
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (!roleIn(id, email)) return c.json({ error: "Only the Host and Co-hosts can rename people" }, 403);
    const { playerId, postId, key, name, locked } = body.data;
    if (key !== undefined) {
      const who = [...knownPeople(id)].find((e) => personKey(id, e) === key);
      if (!who) return c.json({ error: "No such person in this Game" }, 404);
      renamePerson(id, game, { email: who }, name, locked);
    } else if (playerId !== undefined) {
      if (!roster(game.state).some((p) => p.id === playerId)) return c.json({ error: "No such Player in this Game" }, 404);
      renamePerson(id, game, { playerId }, name, locked);
    } else {
      const by = db
        .select({ email: posts.email })
        .from(posts)
        .where(and(eq(posts.gameId, id), eq(posts.id, postId!)))
        .get();
      if (!by) return c.json({ error: "No such Post in this Game" }, 404);
      renamePerson(id, game, { email: by.email }, name, locked);
    }
    return c.body(null, 204);
  });

  app.get("/api/games/:id/staff", (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (!roleIn(id, email)) return c.json({ error: "Only the Host and Co-hosts" }, 403);
    return c.json({ staff: staffOf(id, game).map(({ playerId, role }) => ({ playerId, role })) });
  });

  app.post("/api/games/:id/cohosts", async (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, cohostBody);
    if (!body.ok) return body.res;
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (roleIn(id, email) !== "host") return c.json({ error: "Only the Host can appoint Co-hosts" }, 403);
    const { email: who, playsAs } = body.data;
    if (playsAs !== undefined && !roster(game.state).some((p) => p.id === playsAs)) return c.json({ error: "No such Player in this Game" }, 400);
    const row = { gameId: id, email: who, role: "cohost" as const, ...(playsAs ? { playerId: playsAs } : {}) };
    if (playsAs)
      db.insert(gameHosts)
        .values(row)
        .onConflictDoUpdate({ target: [gameHosts.gameId, gameHosts.email], set: { playerId: playsAs } })
        .run();
    else db.insert(gameHosts).values(row).onConflictDoNothing().run();
    staffChanged(id);
    return c.body(null, 204);
  });

  /** Who co-hosts this Game, for the Host and the Co-hosts themselves. */
  app.get("/api/games/:id/cohosts", (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    if (!load(id)) return c.json({ error: "Game not found" }, 404);
    if (!roleIn(id, email)) return c.json({ error: "Only the Host and Co-hosts" }, 403);
    const rows = db
      .select({ email: gameHosts.email })
      .from(gameHosts)
      .where(and(eq(gameHosts.gameId, id), eq(gameHosts.role, "cohost")))
      .orderBy(asc(gameHosts.email))
      .all();
    return c.json({ cohosts: rows.map((r) => r.email) });
  });

  /** The Host takes someone off the Game's Co-hosts. The Host can't be removed this way. */
  app.delete("/api/games/:id/cohosts/:email", (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    if (!load(id)) return c.json({ error: "Game not found" }, 404);
    if (roleIn(id, email) !== "host") return c.json({ error: "Only the Host can remove Co-hosts" }, 403);
    const who = c.req.param("email").trim().toLowerCase();
    db.delete(gameHosts)
      .where(and(eq(gameHosts.gameId, id), eq(gameHosts.email, who), eq(gameHosts.role, "cohost")))
      .run();
    staffChanged(id);
    return c.body(null, 204);
  });

  /** The Host deletes their own Game, with everything in it (not a Co-host: it's the Host's Game). */
  app.delete("/api/games/:id", (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (roleIn(id, email) !== "host") return c.json({ error: "Only the Host can delete a Game" }, 403);
    // A party may be under way: it's ended on purpose first, never deleted out from under the room.
    const now = phase(game.state);
    if (now === "playing" || now === "finalRound") return c.json({ error: "End the Game before deleting it" }, 409);
    deleteGame(id);
    return c.body(null, 204);
  });

  app.get("/api/games/:id", (c) => {
    const id = c.req.param("id");
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    // Only this answer says who is asking: live updates go to everyone watching, so they never carry a role.
    const email = signedInAs(c);
    // Remembered so the Host can find them by name in the Co-hosts panel (not the demo's stand-ins).
    if (email && !email.startsWith(DEMO_ACTOR))
      db.insert(gameVisitors).values({ gameId: id, email, firstSeenAt: now() }).onConflictDoNothing().run();
    const playerId = email ? playerOf(id, email, game) : undefined;
    return c.json({
      ...view(id, game, now()),
      role: (email && roleIn(id, email)) ?? null,
      me: playerId ? { playerId } : null,
      myName: email ? nameIn(id, email, game) : null,
      muted: (email && nameRow(id, email)?.muted) ?? false,
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

    // A demo Game's made-up Players each get a stand-in email, so the Host can find them in the Co-hosts panel and
    // make one a Co-host, as with real people. At example.com, which takes no mail: nobody can ever sign in as one.
    const cmd = body.data;
    const standIn = game.demo && cmd.type === "AddPlayer" ? demoEmail(id, cmd.name) : undefined;
    const result = run(id, game, cmd, (tx) => {
      if (standIn && cmd.type === "AddPlayer") tx.insert(gamePlayers).values({ gameId: id, playerId: cmd.playerId, email: standIn }).run();
    });
    if (!("code" in result) && cmd.type === "ChangeSettings")
      for (const [option, value] of Object.entries(cmd.settings))
        if (value !== game.state.settings[option as keyof typeof game.state.settings]) stats.optionChanged(id, option);
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
    // Every Reaction in the Game, tallied per Post in the order they're offered, with the viewer's own marked.
    const tallies = new Map<string, Map<string, { count: number; mine: boolean }>>();
    for (const r of db.select().from(postReactions).where(eq(postReactions.gameId, id)).all()) {
      const tally = tallies.get(r.postId) ?? new Map<string, { count: number; mine: boolean }>();
      const t = tally.get(r.emoji) ?? { count: 0, mine: false };
      tally.set(r.emoji, { count: t.count + 1, mine: t.mine || r.email === email });
      tallies.set(r.postId, tally);
    }
    const reactionsOf = (postId: string) =>
      REACTIONS.flatMap((emoji) => {
        const t = tallies.get(postId)?.get(emoji);
        return t ? [{ emoji, ...t }] : [];
      });
    // A reply quotes the Post it answers, if this viewer may see that Post; otherwise it's shown as removed.
    // Each Post counts its replies that everyone can see.
    const seenById = new Map(rows.map((p) => [p.id, p]));
    const replies = new Map<string, number>();
    for (const p of rows) if (p.replyTo && p.status === "visible") replies.set(p.replyTo, (replies.get(p.replyTo) ?? 0) + 1);
    const photoOf = (p: (typeof rows)[number]) =>
      p.photoWidth && p.photoHeight ? { url: `/api/games/${id}/posts/${p.id}/photo`, width: p.photoWidth, height: p.photoHeight } : null;
    const mutedPeople = new Set(
      hosting
        ? db
            .select({ email: gameNames.email })
            .from(gameNames)
            .where(and(eq(gameNames.gameId, id), eq(gameNames.muted, true)))
            .all()
            .map((r) => r.email)
        : [],
    );
    const quote = (replyTo: string | null) => {
      if (!replyTo) return null;
      const o = seenById.get(replyTo);
      return o ? { id: o.id, author: o.author, text: o.text, photo: photoOf(o) } : { id: replyTo, removed: true as const };
    };
    return c.json(
      rows.map((p) => ({
        id: p.id,
        author: p.author,
        giftId: p.giftId,
        text: p.text,
        photo: photoOf(p),
        status: p.status,
        createdAt: p.createdAt.getTime(),
        mine: p.email === email,
        reactions: reactionsOf(p.id),
        replyTo: quote(p.replyTo),
        replies: replies.get(p.id) ?? 0,
        // For the Host and Co-hosts: whether its poster is muted, so they can unmute from here.
        ...(hosting ? { authorMuted: mutedPeople.has(p.email) } : {}),
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
      const parsed = postBody.safeParse({ text: field("text"), name: field("name"), giftId: field("giftId"), replyTo: field("replyTo") });
      body = parsed.success ? { ok: true, data: parsed.data } : { ok: false, res: c.json({ error: "Invalid request", issues: parsed.error.issues }, 400) };
    } else {
      body = await parseBody(c, postBody);
    }
    if (!body.ok) return body.res;
    if (!body.data.text && !upload) return c.json({ error: "Write something or add a Photo" }, 400);
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (game.moderation === "paused") return c.json({ code: "Paused", message: "The Host has paused posting" }, 409);
    if (nameRow(id, email)?.muted) return c.json({ code: "Muted", message: "The Host has paused your posting" }, 409);
    const { text, giftId, replyTo } = body.data;
    if (giftId !== undefined && !gifts(game.state).some((g) => g.id === giftId)) return c.json({ error: "No such Gift in this Game" }, 400);
    if (
      replyTo !== undefined &&
      !db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.gameId, id), eq(posts.id, replyTo), eq(posts.status, "visible")))
        .get()
    )
      return c.json({ error: "That Post can't be replied to" }, 400);
    // A Player posts as their Player; a Guest as their name in this Game, which they give (or change) here unless
    // the Host or a Co-host has locked it.
    const playerId = playerOf(id, email, game);
    const saved = playerId ? undefined : nameRow(id, email);
    const fixed = saved?.locked && saved.name ? saved.name : undefined;
    const wants = playerId || fixed ? undefined : body.data.name;
    // Under Approve names, a new name waits, and they post as the old one (or as "Guest") until it's approved.
    const held = wants !== undefined && wants !== saved?.name && needsApproval(id, email, game);
    const waiting = saved?.name ?? WAITING_GUEST;
    const author = playerId
      ? roster(game.state).find((p) => p.id === playerId)!.name
      : (fixed ?? (held ? waiting : (wants ?? saved?.name ?? (saved?.pending ? waiting : undefined))));
    if (!author) return c.json({ error: "Say what name to post as" }, 400);

    const photo = upload && (await preparePhoto(new Uint8Array(await upload.arrayBuffer())));
    if (upload && !photo) return c.json({ error: "That doesn't look like a photo we can use" }, 400);

    // A Guest's new or changed name is theirs from now on, on their earlier Posts too.
    if (held) {
      if (wants !== saved?.pending) holdName(id, email, wants);
    } else if (!playerId && author !== saved?.name && author !== WAITING_GUEST) renamePerson(id, game, { email }, author);

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
          replyTo: replyTo ?? null,
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
    stats.recordOrg(id);
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

  /** The Organizer deletes their Organization. Games that used its look keep going, in their own or the app's colors. */
  app.delete("/api/orgs/:orgId", (c) => {
    const orgId = c.req.param("orgId");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    if (!orgTheme(orgId)) return c.json({ error: "No such Organization" }, 404);
    if (!organizes(orgId, email)) return c.json({ error: "Only its Organizer can delete an Organization" }, 403);
    const using = db.select({ id: games.id }).from(games).where(eq(games.orgId, orgId)).all();
    stats.orgDeleted(orgId);
    db.transaction((tx) => {
      tx.update(games).set({ orgId: null }).where(eq(games.orgId, orgId)).run();
      tx.delete(organizations).where(eq(organizations.id, orgId)).run();
    });
    for (const kind of ["logo", "background"] as const) themeImages.remove(`org-${orgId}`, kind);
    for (const { id } of using) {
      const game = cache.get(id);
      if (game) publish(id, { ...game, theme: { ...game.theme, org: null } });
    }
    return c.body(null, 204);
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
      if (method === "put") stats.noteFeature(id, "ownLook");
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
    const { name, turnSeconds, rosterMode, approveNames } = body.data;
    const set = {
      ...(approveNames !== undefined ? { approveNames } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(turnSeconds !== undefined ? { turnSeconds } : {}),
      ...(rosterMode !== undefined ? { rosterMode } : {}),
    };
    if (Object.keys(set).length > 0) db.update(games).set(set).where(eq(games.id, id)).run();
    const was = { turnSeconds: game.turnSeconds, rosterMode: game.rosterMode, approveNames: game.approveNames };
    for (const [option, value] of Object.entries({ turnSeconds, rosterMode, approveNames }))
      if (value !== undefined && value !== was[option as keyof typeof was]) stats.optionChanged(id, option);
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
    if (color !== undefined || page !== undefined) stats.noteFeature(id, "ownLook");
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

  // The Host switches the big screen between the Gift board, the rules, the join code and the catalog.
  app.post("/api/games/:id/screen", async (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, screenModeBody);
    if (!body.ok) return body.res;
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    if (!roleIn(id, email)) return c.json({ error: "Only the Host and Co-hosts can switch the big screen" }, 403);
    db.update(games).set({ screenMode: body.data.mode }).where(eq(games.id, id)).run();
    stats.noteFeature(id, `screen:${body.data.mode}`);
    publish(id, { ...game, screen: body.data.mode });
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
    if (body.data.mode !== game.moderation) stats.optionChanged(id, "moderation");
    publish(id, { ...game, moderation: body.data.mode });
    return c.body(null, 204);
  });

  // Anyone signed in can put a Reaction on a visible Post or take it back, even while posting is Paused.
  app.post("/api/games/:id/posts/:postId/reactions", async (c) => {
    const { id, postId } = c.req.param();
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in to react" }, 401);
    const body = await parseBody(c, reactionBody);
    if (!body.ok) return body.res;
    const target = db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.gameId, id), eq(posts.id, postId), eq(posts.status, "visible")))
      .get();
    if (!target) return c.json({ error: "Post not found" }, 404);
    const { emoji, on } = body.data;
    const changed = on
      ? db.insert(postReactions).values({ gameId: id, postId, email, emoji }).onConflictDoNothing().run()
      : db
          .delete(postReactions)
          .where(and(eq(postReactions.postId, postId), eq(postReactions.email, email), eq(postReactions.emoji, emoji)))
          .run();
    if (changed.changes > 0) postsChanged(id);
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
    const all = db.select({ id: posts.id, replyTo: posts.replyTo, status: posts.status }).from(posts).where(eq(posts.gameId, id)).all();
    if (!all.some((p) => p.id === postId)) return c.json({ error: "Post not found" }, 404);
    db.transaction((tx) => {
      const at = and(eq(posts.gameId, id), eq(posts.id, postId));
      if (body.data.status === "visible") {
        tx.update(posts).set({ status: "visible", hiddenWith: null }).where(at).run();
        // Whatever was hidden along with it (its thread) comes back too; a reply hidden on its own stays hidden.
        tx.update(posts)
          .set({ status: "visible", hiddenWith: null })
          .where(and(eq(posts.gameId, id), eq(posts.hiddenWith, postId)))
          .run();
        return;
      }
      tx.update(posts).set({ status: "hidden" }).where(at).run();
      if (!body.data.thread) return;
      // Every visible reply under it, however deep, goes with it.
      const under = new Set([postId]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const p of all) if (p.replyTo && under.has(p.replyTo) && !under.has(p.id)) (under.add(p.id), (grew = true));
      }
      under.delete(postId);
      const replies = all.filter((p) => under.has(p.id) && p.status === "visible").map((p) => p.id);
      if (replies.length > 0)
        tx.update(posts)
          .set({ status: "hidden", hiddenWith: postId })
          .where(and(eq(posts.gameId, id), inArray(posts.id, replies)))
          .run();
    });
    postsChanged(id);
    return c.body(null, 204);
  });

  /**
   * Attaches a Post to a Gift after it was posted (a great photo whose poster didn't pick the Gift), or takes it off.
   * For its poster, and the Host and Co-hosts.
   */
  app.post("/api/games/:id/posts/:postId/gift", async (c) => {
    const { id, postId } = c.req.param();
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, postGiftBody);
    if (!body.ok) return body.res;
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    const row = db
      .select({ email: posts.email })
      .from(posts)
      .where(and(eq(posts.gameId, id), eq(posts.id, postId)))
      .get();
    if (!row) return c.json({ error: "Post not found" }, 404);
    if (row.email !== email && !roleIn(id, email)) return c.json({ error: "Only its poster, the Host and Co-hosts can change this Post" }, 403);
    const { giftId } = body.data;
    if (giftId !== null && !gifts(game.state).some((g) => g.id === giftId)) return c.json({ error: "No such Gift in this Game" }, 400);
    db.update(posts)
      .set({ giftId })
      .where(and(eq(posts.gameId, id), eq(posts.id, postId)))
      .run();
    postsChanged(id);
    return c.body(null, 204);
  });

  /** The Host or a Co-host mutes whoever wrote a Post (they can't post or reply), or unmutes them. */
  app.post("/api/games/:id/mute", async (c) => {
    const id = c.req.param("id");
    const email = signedInAs(c);
    if (!email) return c.json({ error: "Sign in first" }, 401);
    const body = await parseBody(c, muteBody);
    if (!body.ok) return body.res;
    if (!load(id)) return c.json({ error: "Game not found" }, 404);
    if (!roleIn(id, email)) return c.json({ error: "Only the Host and Co-hosts can moderate this Game" }, 403);
    const { postId, muted, hidePosts } = body.data;
    const by = db
      .select({ email: posts.email })
      .from(posts)
      .where(and(eq(posts.gameId, id), eq(posts.id, postId)))
      .get();
    if (!by) return c.json({ error: "Post not found" }, 404);
    const theirs = and(eq(posts.gameId, id), eq(posts.email, by.email));
    db.transaction((tx) => {
      tx.insert(gameNames)
        .values({ gameId: id, email: by.email, muted })
        .onConflictDoUpdate({ target: [gameNames.gameId, gameNames.email], set: { muted } })
        .run();
      if (muted && hidePosts)
        tx.update(posts)
          .set({ status: "hidden", hiddenWith: "mute" })
          .where(and(theirs, eq(posts.status, "visible")))
          .run();
      // Unmuting brings back what the mute hid, and nothing hidden for another reason.
      if (!muted)
        tx.update(posts)
          .set({ status: "visible", hiddenWith: null })
          .where(and(theirs, eq(posts.hiddenWith, "mute")))
          .run();
    });
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
    // Under Approve names, they play as "New player" until the Host or a Co-host approves the name they gave.
    const held = needsApproval(id, email, game);
    const result = run(id, game, { type: "AddPlayer", playerId, name: held ? WAITING_PLAYER : body.data.name }, (tx) => {
      if (held)
        tx.insert(gameNames)
          .values({ gameId: id, email, pending: body.data.name })
          .onConflictDoUpdate({ target: [gameNames.gameId, gameNames.email], set: { pending: body.data.name } })
          .run();
      // A link left over from a Player the Host has since removed gives way to the new one.
      tx.delete(gamePlayers).where(and(eq(gamePlayers.gameId, id), eq(gamePlayers.email, email))).run();
      tx.insert(gamePlayers).values({ gameId: id, playerId, email }).run();
    });
    if (held && !("code" in result)) staffChanged(id);
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
        tipNoteRead: u.tipNoteRead,
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

  /** The usage statistics (ADR-0005), brought up to date first. */
  app.get("/api/admin/stats", (c) => {
    stats.refresh();
    return c.json(stats.summary({ signInEmailCap: linkLimits.perDay, photoBytes: photos.bytes(), ratings: said.hostRatings() }));
  });

  /** What Hosts and guests said, newest first, with the averages. */
  app.get("/api/admin/feedback", (c) => c.json(said.summary()));

  /** Puts a testimonial on the front page, or takes it down: only one its writer said may be quoted. */
  app.post("/api/admin/feedback/:id/published", async (c) => {
    const body = await parseBody(c, publishBody);
    if (!body.ok) return body.res;
    if (!said.setPublished(c.req.param("id"), body.data.published)) return c.json({ error: "Not something that may be quoted" }, 409);
    return c.body(null, 204);
  });

  /** Leaves a Game out of the statistics (Jim's trial runs), or puts it back. */
  app.post("/api/admin/stats/games/:id", async (c) => {
    const body = await parseBody(c, excludeBody);
    if (!body.ok) return body.res;
    if (!stats.setExcluded(c.req.param("id"), body.data.excluded)) return c.json({ error: "No such Game" }, 404);
    return c.body(null, 204);
  });

  /** Removes a Game and everything kept for it: its log, Hosts, Players, Posts and their Photos, votes, Theme images. */
  function deleteGame(id: string) {
    stats.snapshotGame(id, true); // its last word in the statistics, which outlive it
    db.transaction((tx) => {
      for (const table of [votes, postReactions, posts, gameNames, gameVisitors, turnClocks, gamePlayers, gameHosts, gameEvents]) tx.delete(table).where(eq(table.gameId, id)).run();
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
    for (const { id } of testOrgs) stats.orgDeleted(id);
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
        const photoOnly = and(photoPosts, eq(posts.text, ""));
        const gone = tx.select({ id: posts.id }).from(posts).where(photoOnly).all().map((p) => p.id);
        if (gone.length) tx.delete(postReactions).where(inArray(postReactions.postId, gone)).run();
        tx.delete(posts).where(photoOnly).run();
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
    const sweeping = setInterval(() => {
      sweep();
      void followUps();
    }, 60 * 60_000);
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
        stats.notePeakScreens(gameId, sockets.sockets.adapter.rooms.get(gameId)?.size ?? 1);
        socket.emit("game", view(gameId, load(gameId)!, now()));
        socket.emit("posts"); // the Feed may have changed while this screen was asleep
      });
    });
  }

  /**
   * Emails each Host who said it's OK, a day after their Game ended, to ask how it went: once per Game, and only
   * within a share of the day's email allowance, so sign-in links always come first. Returns how many were sent.
   */
  async function followUps(): Promise<number> {
    if (!mailer.sendFeedbackRequest) return 0;
    let sent = 0;
    for (const { gameId, name, email } of said.dueForFollowUp(linkLimits.perDay)) {
      try {
        await mailer.sendFeedbackRequest(email, name, `${baseUrl}/games/${gameId}`);
        said.followedUp(gameId);
        stats.countToday("feedbackEmails");
        sent++;
      } catch (err) {
        console.error("Couldn't send a feedback request", err);
        break; // most likely the email allowance: try again in an hour
      }
    }
    return sent;
  }

  return { app, listen, sweep, followUps };
}
