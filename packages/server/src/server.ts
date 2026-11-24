import { randomBytes, randomInt } from "node:crypto";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { serveStatic } from "@hono/node-server/serve-static";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, asc, desc, eq, inArray, isNotNull, like, lte, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  activePlayers,
  gifts,
  leftoverGiftCount,
  onDeck,
  phase,
  roster,
  type Command,
  type DrawFn,
} from "@elephant/rules";
import { Server as SocketServer } from "socket.io";
import { diskOf, lastBackupAt, memoryLimit, type ServerHealth } from "./system.js";
import { createAccess, DEMO_ACTOR, DEMO_DRAWS_HEADER, SESSION_COOKIE } from "./access.js";
import { createFeed } from "./feed.js";
import { createGameLifecycle } from "./games.js";
import { createVisitors } from "./visitors.js";
import { adminRoutes } from "./admin-routes.js";
import { createPeople } from "./people.js";
import { peopleRoutes } from "./people-routes.js";
import type * as Wire from "./wire.js";
import { feedRoutes } from "./feed-routes.js";
import { parseBody, photoSizeLimit } from "./http.js";
import { createGameStore, type LoadedGame, type OrgTheme } from "./game-store.js";
import { createAuth, DEFAULT_LIMITS, logMailer, SESSION_LIFETIME_MS, type LinkLimits, type Mailer } from "./auth.js";
import { cleanRef, createStats, isVisitor, VISITOR_DAYS, VISITOR_DOMAIN } from "./stats.js";
import { createFeedback } from "./feedback.js";
import {
  isThemeImage,
  PHOTO_KEEP_DAYS,
  photoStore,
  prepareThemeImage,
  themeStore,
  type ThemeImage,
} from "./photos.js";
import { gameEvents, gameHosts, games, gameVisitors, openDb, organizations, postReactions, posts, sessions, users, type Tx } from "./db.js";
import {
  command,
  createGameBody,
  feedbackBody,
  gameOptions,
  gameOptionsEdit,
  gameOrgBody,
  gameThemeEdit,
  linkRedemption,
  linkRequest,
  visitBody,
  featureBody,
  answerBody,
  suggestionBody,
  contactBody,
  moderationBody,
  orgBody,
  orgEdit,
  timerBody,
  voteBody,
  voteDisplayBody,
  screenModeBody,
  voteStatusBody,
} from "./schemas.js";

export type { Mailer } from "./auth.js";
/** Every response, as the browser receives it, for the web app (wire.ts). */
export type * from "./wire.js";


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
  /**
   * Which build of the web app this server hands out. Every API answer says so (X-App-Build), and a page running an
   * older build offers to reload. Worked out from webRoot's index.html when left out; with neither, nothing is said.
   */
  build?: string;
  /** The git commit this server was built from (the deploy passes it into the image); left out outside production. */
  commit?: string;
  /** Where Photos are stored. Left out (as in most tests), they go to a fresh temporary folder. */
  photosDir?: string;
  /** Where Theme logos and backgrounds are stored; likewise a temporary folder if left out. */
  themesDir?: string;
  /** Who may use the admin pages (from ADMIN_EMAILS). Left out, there are none and those pages don't exist. */
  adminEmails?: readonly string[];
  /**
   * The least time between "the Feed changed" signals to a Game's screens (ms). The first change is signalled at
   * once; any more within this time are gathered into one signal at its end, so a burst of Reactions at a big party
   * doesn't send every phone back for the Feed again and again. 0 (the default, as in tests) signals every change.
   */
  feedSignalMs?: number;
  /**
   * When the server counts as too busy to take on another Game: this many screens connected at once, or its event
   * loop falling more than maxLagMs behind (the 99th percentile over a few seconds). Then creating a Game (a demo
   * too) is turned away with a friendly "try again in a few minutes", so the parties already under way stay
   * smooth. Left out (as in tests), there's no limit.
   */
  overload?: { maxScreens?: number; maxLagMs?: number };
  /**
   * The tag at the front of every new Game's id ("a" makes "a.<random>"): which server holds the Game, so Caddy
   * could one day send each Game's requests to its own server (docs/scale-plan.md, "One server per Game"). A few
   * lowercase letters or digits. Defaults to "a", the first server.
   */
  serverTag?: string;
  /** Where backup.ts writes the database's backups, so the System page can say when the last was taken. */
  backupsDir?: string;
}

/** The header every API answer carries naming the web app's current build. */
export const BUILD_HEADER = "x-app-build";
/** A build's name: the content hash in its main script's file name (index-<hash>.js), which changes with any change. */
export const buildOf = (indexHtml: string) => /\/assets\/index-([\w-]+)\.js/.exec(indexHtml)?.[1];

/** Contact-form messages one address may send in an hour, and how many are emailed to Jim a day (the rest wait on the Feedback page). */
export const CONTACTS_PER_HOUR = 5;
/** Demo visitors (trying it without signing in) one address may start in an hour: a party's worth of curious phones. */
export const DEMO_VISITORS_PER_HOUR = 20;
export const CONTACT_EMAILS_PER_DAY = 50;

/** How long a Game nobody asks for (and no screen watches) stays in memory; the database always has it. */
export const IDLE_GAME_HOURS = 6;

const randomDraw: DrawFn = (candidates) => candidates[randomInt(candidates.length)]!;

/**
 * A guided demo's Draws (ADR 0006): each Draw takes the first listed Player who may be drawn now, and uses them up.
 * Anyone listed who can't be drawn is passed over; once none of the list can, `otherwise` draws.
 */
export function scriptedDraws(listed: string[], otherwise: DrawFn): DrawFn {
  const left = [...listed];
  return (candidates) => {
    const i = left.findIndex((id) => candidates.includes(id));
    return i < 0 ? otherwise(candidates) : left.splice(i, 1)[0]!;
  };
}


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
export function view(id: string, game: LoadedGame, now: Date) {
  const { name, tagline, whenWhere, demo, rosterMode, moderation, approveNames, turnSeconds, postsPerMinute, repitchMinutes, clocks, state, seq, vote, screen } = game;
  return {
    id,
    name,
    tagline,
    /** When and where the party is, in the Host's words; "" for none. */
    whenWhere,
    demo,
    theme: resolveTheme(id, game.theme),
    rosterMode,
    moderation,
    approveNames,
    postsPerMinute,
    repitchMinutes,
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
  build = webRoot ? buildOf(readFileSync(join(webRoot, "index.html"), "utf8")) : undefined,
  adminEmails = [],
  commit,
  feedSignalMs = 0,
  serverTag = "a",
  backupsDir,
  overload = {},
}: ServerOptions) {
  if (!/^[a-z0-9]{1,8}$/.test(serverTag)) throw new Error(`serverTag must be 1–8 lowercase letters or digits, not "${serverTag}"`);
  const db = openDb(dbPath);
  const photosRoot = photosDir ?? mkdtempSync(join(tmpdir(), "elephant-photos-"));
  const photos = photoStore(photosRoot);
  const startedAt = new Date();
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
  /** People in a Game: who someone is there, and their role (people.ts). */
  const people = createPeople<LoadedGame, ReturnType<typeof run>>({
    db,
    rosterOf: (game) => roster(game.state),
    latest: (id) => load(id)!,
    approveNames: (game) => game.approveNames,
    command: (id, cmd, alsoWrite) => run(id, cmd, alsoWrite),
    renameAuthor: (tx, id, email, name) => feed.renameAuthor(tx, id, email, name),
    postsChanged: (id) => postsChanged(id),
    staffChanged: (id) => staffChanged(id),
  });
  /** Game access (access.ts): who is asking about a Game, and whether they may. */
  const access = createAccess<LoadedGame>({
    sessionEmail: (token) => auth.sessionEmail(token),
    load: (id) => load(id),
    onRoster: (game, playerId) => roster(game.state).some((p) => p.id === playerId),
    people,
  });
  /** Who is asking: the signed-in person, or the made-up Player a demo page's sample phone is. */
  const signedInAs = access.emailOf;
  const { roleIn, nameRow, nameIn } = people;
  /** Every Game a request asks for, and every change to one (game-store.ts). */
  const store = createGameStore({ db, now, draw, orgTheme: (orgId) => orgTheme(orgId) });
  const load = (id: string) => store.get(id);

  /** An Organization's Theme as it stands, with its id and name; null if there's no such Organization. */
  function orgTheme(orgId: string): OrgTheme | null {
    const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
    return org ? { id: org.id, name: org.name, color: org.color, page: org.page, logo: org.logo, background: org.background } : null;
  }

  /** Whether this person may give a Game this Organization's Theme: only its Organizer may. */
  const organizes = (orgId: string, email: string) =>
    db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.id, orgId), eq(organizations.organizerEmail, email))).get() !== undefined;

  /** After an Organizer changes their Organization, brings every Game showing it up to date on every screen. */
  const orgChanged = (orgId: string) => store.orgChanged(orgId);

  /** The Player this person signed up as, if they did and are still on the Roster. */







  /**
   * Decides a command against the latest copy of the Game, logs its events and tells every screen (see the Game
   * store). Returns the Game as now shown, or the rule that refused the command. The Game must exist.
   */
  function run(id: string, cmd: Command, alsoWrite?: (tx: Tx, game: LoadedGame) => void, drawWith?: DrawFn) {
    const result = store.command(id, cmd, alsoWrite, drawWith)!;
    return "code" in result ? result : view(id, result, now());
  }

  /** Each Game's Feed: its Posts and Reactions, as each viewer may see them (feed.ts). */
  const feed = createFeed({ db, now, store, photos, muted: people, signal: (id) => io?.to(id).emit("posts"), signalMs: feedSignalMs });
  /** Creating, forgetting and deleting Games: the one place that knows every part of one (games.ts). */
  const lifecycle = createGameLifecycle({ db, store, feed, people, photos, themeImages, lastWord: (id) => stats.snapshotGame(id, true) });
  /** Removes a Game and everything kept for it (games.ts). */
  const deleteGame = (id: string) => lifecycle.remove(id);
  /** Unique visitors to the site, counted without tracking anyone (visitors.ts). */
  const visitors = createVisitors({ db, now });
  /** After any change to a Game's Posts or Reactions: every screen watching asks for the Feed again. */
  const postsChanged = (id: string) => feed.changed(id);

  /** Every change to a Game goes to every screen watching it. */
  store.onChange((id, game) => io?.to(id).emit("game", view(id, game, now())));

  /** Whether the event loop has lately fallen too far behind (see overload); kept up to date while listening. */
  let lagging = false;
  /** The event loop's latest delay (99th percentile over 5 s, ms), for the System page; null until measured. */
  let lagMs: number | null = null;
  /** The most screens connected at once since this server started, for the System page. */
  let peakScreens = 0;
  /** Whether to turn away a new Game, to keep the parties under way smooth (see overload). */
  function tooBusy() {
    const screens = io?.engine.clientsCount ?? 0;
    return lagging || (overload.maxScreens !== undefined && screens >= overload.maxScreens);
  }

  /** Set once listening: every screen watching a Game sits in a room named by the Game's id. */
  let io: SocketServer | undefined;

  const app = new Hono();

  // After a deploy, pages still open on the old build see this differ from their own, and offer to reload.
  if (build) {
    app.use("/api/*", async (c, next) => {
      await next();
      c.res.headers.set(BUILD_HEADER, build);
    });
  }

  // Who is asking about a Game, worked out once per request: the demo page's sample phone (ADR 0004) and demo
  // visitors, who count as not signed in in a real Game (see access.ts).
  app.use("/api/games/:id", access.identify);
  app.use("/api/games/:id/*", access.identify);

  // For Docker's HEALTHCHECK and uptime monitors: up only if the database answers.
  app.get("/api/health", (c) => {
    c.header("Cache-Control", "no-store");
    try {
      db.$client.prepare("select 1").get();
      return c.json({ ok: true, busy: tooBusy() });
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

  /**
   * A feature only the browser sees, used in a Game: pasting the roster (by its Host or a Co-host), or sharing a Post
   * outside the party (by anyone following it, signed in or not; it only marks that the Game had a share).
   */
  app.post("/api/games/:id/features", access.need("anyone"), async (c) => {
    const { id, email, role } = c.var.access;
    const body = await parseBody(c, featureBody);
    if (!body.ok) return body.res;
    if (body.data.feature !== "share") {
      if (!email) return c.json({ error: "Sign in first" }, 401);
      if (!role) return c.json({ error: "Only the Host and Co-hosts" }, 403);
    }
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

  app.get("/api/games/:id/feedback", access.need("signedIn"), (c) => {
    const { id } = c.var.access;
    const email = c.var.access.email!;
    const { asked, as, given } = feedbackFor(id, email);
    return c.json({
      asked,
      as,
      given: given && { rating: given.rating, again: given.again, thumbs: given.thumbs, comment: given.comment, quoteOk: given.quoteOk, quoteName: given.quoteName },
    } satisfies Wire.FeedbackAsk);
  });

  app.post("/api/games/:id/feedback", access.need("signedIn"), async (c) => {
    const { id } = c.var.access;
    const email = c.var.access.email!;
    const body = await parseBody(c, answerBody);
    if (!body.ok) return body.res;
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

  /**
   * The contact form: a message to Jim from anyone, signed in or not, with an address for a reply if they want one.
   * It's kept with the suggestions on the admin's Feedback page and emailed to the admins, so Jim's own address is
   * never on the site. At most CONTACTS_PER_HOUR from one address and CONTACT_EMAILS_PER_DAY emailed site-wide (the
   * rest are still kept); a message with the hidden `website` field filled in came from a bot and is dropped.
   */
  /**
   * Trying the demo without signing in: a stand-in session (see VISITOR_DOMAIN) so the demo opens at once, with
   * nothing to type. Someone already signed in keeps their own. At most DEMO_VISITORS_PER_HOUR from one address,
   * and none while the server is too busy.
   */
  const visitorsFrom = new Map<string, number[]>();
  app.post("/api/demo/visitor", (c) => {
    const email = signedInAs(c);
    if (email) return c.json({ email, visitor: isVisitor(email) });
    if (tooBusy()) return c.json({ error: "busy" }, 503);
    const ip = clientIp(c);
    const hourAgo = now().getTime() - 60 * 60_000;
    const recent = (visitorsFrom.get(ip) ?? []).filter((t) => t > hourAgo);
    if (recent.length >= DEMO_VISITORS_PER_HOUR) return c.json({ error: "tooMany" }, 429);
    visitorsFrom.set(ip, [...recent, now().getTime()]);
    const visitor = auth.startVisitor();
    setCookie(c, SESSION_COOKIE, visitor.sessionToken, {
      httpOnly: true,
      sameSite: "Lax",
      secure: baseUrl.startsWith("https:"),
      path: "/",
      maxAge: VISITOR_DAYS * 24 * 60 * 60,
    });
    stats.countToday("demoVisitors");
    return c.json({ email: visitor.email, visitor: true });
  });

  const contactsFrom = new Map<string, number[]>();
  let contactEmailsToday = { day: "", sent: 0 };
  app.post("/api/contact", async (c) => {
    const body = await parseBody(c, contactBody);
    if (!body.ok) return body.res;
    if (body.data.website) return c.body(null, 204); // a bot: say thanks, keep nothing
    const ip = clientIp(c);
    const hourAgo = now().getTime() - 60 * 60_000;
    const recent = (contactsFrom.get(ip) ?? []).filter((t) => t > hourAgo);
    if (recent.length >= CONTACTS_PER_HOUR) return c.json({ error: "tooMany" }, 429);
    contactsFrom.set(ip, [...recent, now().getTime()]);

    const signedIn = signedInAs(c);
    const email = isVisitor(signedIn) ? undefined : signedIn; // someone trying the demo hasn't given an address
    const replyTo = body.data.replyTo || email;
    said.suggest(email, body.data.message, replyTo);
    const day = now().toISOString().slice(0, 10);
    if (contactEmailsToday.day !== day) contactEmailsToday = { day, sent: 0 };
    if (mailer.sendContactMessage && admins.size > 0 && contactEmailsToday.sent < CONTACT_EMAILS_PER_DAY) {
      contactEmailsToday.sent++;
      // Kept either way, so a failed email never loses the message: it's on the Feedback page.
      await mailer.sendContactMessage([...admins], body.data.message, replyTo, email ? "a signed-in Host" : "a visitor").catch((e: unknown) => console.error("Contact email failed", e));
    }
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
      // Trying the demo without signing in: demo Games only, until they sign in with their email.
      visitor: isVisitor(email),
      myOptions: mine?.success ? mine.data : null,
      alwaysMyOptions: Boolean(mine?.success && me?.alwaysMyOptions),
    } satisfies Wire.Session);
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
    if (tooBusy()) return c.json({ error: "busy" }, 503);
    const body = await parseBody(c, createGameBody);
    if (!body.ok) return body.res;
    const { orgId } = body.data;
    if (isVisitor(email) && !body.data.demo) return c.json({ error: "signInToHost" }, 403);
    if (orgId !== undefined && !organizes(orgId, email)) return c.json({ error: "Only an Organization's Organizer can use its Theme" }, 403);
    // 16 random bytes: unguessable, so a Game can't be found without its link or QR code. The tag names its server.
    const id = `${serverTag}.${randomBytes(16).toString("base64url")}`;
    const { rosterMode, turnSeconds, approveNames, moderation, settings, start, looked, remember } = body.data;
    const options = { ...settings, turnSeconds, rosterMode, approveNames, moderation };
    const row = {
      id,
      name: body.data.name,
      rosterMode,
      turnSeconds,
      approveNames,
      moderation,
      orgId: orgId ?? null,
      demo: body.data.demo,
      settings: JSON.stringify(settings),
      // While people arrive, the big screen shows how to join; it turns to the Gifts at the start (see run).
      screenMode: "qr" as const,
      createdAt: now(),
    };
    lifecycle.create(row, email, (tx) => {
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
        return { id, name: game.name, phase: phase(game.state), players: roster(game.state).length, role } satisfies Wire.MyGame;
      }),
    );
  });

  /** Tells the Host's and Co-hosts' screens that who co-hosts (or plays as whom) changed. */
  function staffChanged(id: string) {
    io?.to(id).emit("staff");
  }



  // People in a Game: the Co-hosts panel, Names, Co-hosts and self sign-up (people-routes.ts).
  app.route("/", peopleRoutes({ access, people, feed, load: (id) => load(id)!, staffChanged }));

  /** The Host deletes their own Game, with everything in it (not a Co-host: it's the Host's Game). */
  app.delete("/api/games/:id", access.need("host", "Only the Host can delete a Game"), (c) => {
    const { id, game } = c.var.access;
    // A party may be under way: it's ended on purpose first, never deleted out from under the room.
    const now = phase(game.state);
    if (now === "playing" || now === "finalRound") return c.json({ error: "End the Game before deleting it" }, 409);
    deleteGame(id);
    return c.body(null, 204);
  });

  app.get("/api/games/:id", access.need("anyone"), (c) => {
    // Only this answer says who is asking: live updates go to everyone watching, so they never carry a role.
    const { id, game, email, role, playerId } = c.var.access;
    // Remembered so the Host can find them by name in the Co-hosts panel (not the demo's stand-ins).
    // The first time a Player on the guest list opens it, the Staff's consoles show they're in.
    if (email && !email.startsWith(DEMO_ACTOR)) {
      const first = db.insert(gameVisitors).values({ gameId: id, email, firstSeenAt: now() }).onConflictDoNothing().run().changes > 0;
      if (first && playerId) staffChanged(id);
    }
    const viewer = {
      role: role ?? null,
      me: playerId ? { playerId } : null,
      myName: email ? nameIn(id, email, game) : null,
      muted: email ? (nameRow(id, email)?.muted ?? false) : false,
      myVote: (email && game.vote.ballots.get(email)) ?? null,
    } satisfies Wire.Viewer;
    return c.json({ ...view(id, game, now()), ...viewer });
  });

  app.post("/api/games/:id/commands", access.need("staff", "Only the Host and Co-hosts can run this Game"), async (c) => {
    const { id } = c.var.access;
    const body = await parseBody(c, command);
    if (!body.ok) return body.res;
    const game = load(id)!; // the latest copy, read after the body: see GameAccess.game

    // A guided demo names who the Draw picks next, so its script plays the same every time (ADR 0006). Only in a
    // demo Game; the route already lets only its Host and Co-hosts this far.
    const listed = c.req.header(DEMO_DRAWS_HEADER);
    if (listed !== undefined && !game.demo) return c.json({ error: "Only a demo Game can choose its Draws" }, 403);
    const drawWith = listed === undefined ? undefined : scriptedDraws(listed.split(",").filter(Boolean), draw);

    // A demo Game's made-up Players each get a stand-in email, so the Host can find them in the Co-hosts panel and
    // make one a Co-host, as with real people. At example.com, which takes no mail: nobody can ever sign in as one.
    const cmd = body.data;
    const standIn = game.demo && cmd.type === "AddPlayer" ? people.standInEmail(id, cmd.name) : undefined;
    const result = run(id, cmd, (tx) => {
      if (standIn && cmd.type === "AddPlayer") people.linkPlayer(tx, id, cmd.playerId, standIn);
    }, drawWith);
    if (standIn) people.changed(id); // in case the Pick was refused after the link was written
    if (!("code" in result) && cmd.type === "ChangeSettings")
      for (const [option, value] of Object.entries(cmd.settings))
        if (value !== game.state.settings[option as keyof typeof game.state.settings]) stats.optionChanged(id, option);
    return "code" in result ? c.json(result, 409) : c.json(result);
  });

  // The Host restarts a Player's countdown, say after explaining the rules. Not a Pick: it isn't logged or undone.
  app.post("/api/games/:id/timer", access.need("staff", "Only the Host and Co-hosts can run this Game"), async (c) => {
    const { id } = c.var.access;
    const body = await parseBody(c, timerBody);
    if (!body.ok) return body.res;
    // The version doesn't change, since the Game didn't: screens take a copy at the same version as the newer one.
    const game = store.resetClock(id, body.data.playerId);
    if (!game) return c.json({ code: "NotActive", message: "That Player isn't up" }, 409);
    return c.json(view(id, game, now()));
  });

  // The Feed: its Posts, Pitches, Reactions, Photos and their moderation (feed-routes.ts).
  app.route("/", feedRoutes({ access, feed, photos, now, nameToPostAs: people.nameToPostAs, setMuted: people.setMuted, noteFeature: (id, feature) => stats.noteFeature(id, feature) }));

  // Organizations: anyone signed in may create one, and is then its Organizer, the only one who can change it.
  const orgView = (o: OrgTheme): Wire.MyOrg => ({
    id: o.id,
    name: o.name,
    color: o.color,
    page: o.page,
    logoUrl: o.logo ? `/api/orgs/${o.id}/logo?v=${o.logo}` : null,
    backgroundUrl: o.background ? `/api/orgs/${o.id}/background?v=${o.background}` : null,
  });

  app.post("/api/orgs", async (c) => {
    const email = signedInAs(c);
    if (!email || isVisitor(email)) return c.json({ error: "Sign in first" }, 401);
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
    stats.orgDeleted(orgId);
    db.transaction((tx) => {
      tx.update(games).set({ orgId: null }).where(eq(games.orgId, orgId)).run();
      tx.delete(organizations).where(eq(organizations.id, orgId)).run();
    });
    for (const kind of ["logo", "background"] as const) themeImages.remove(`org-${orgId}`, kind);
    store.orgChanged(orgId);
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
    app.on(method.toUpperCase(), "/api/games/:id/theme/:kind", access.need("staff", "Only the Host and Co-hosts can change the Game's look"), photoSizeLimit, async (c) => {
      const { id } = c.var.access;
      const kind = c.req.param("kind");
      if (!isThemeImage(kind)) return c.json({ error: "Not found" }, 404);
      const changed = await changeThemeImage(c, method, `game-${id}`, kind);
      if (changed instanceof Response) return changed;
      const game = store.change(id, () => ({ own: { [kind]: changed.version } }))!;
      if (method === "put") stats.noteFeature(id, "ownLook");
      return c.json(view(id, game, now()).theme);
    });
  }

  // Which Organization's Theme a Game shows: the Host or a Co-host picks one they're the Organizer of, or none.
  app.post("/api/games/:id/org", access.need("staff", "Only the Host and Co-hosts can change the Game's look"), async (c) => {
    const { id } = c.var.access;
    const email = c.var.access.email!;
    const body = await parseBody(c, gameOrgBody);
    if (!body.ok) return body.res;
    const { orgId } = body.data;
    if (orgId !== null && !organizes(orgId, email)) return c.json({ error: "Only an Organization's Organizer can use its Theme" }, 403);
    store.change(id, () => ({ orgId }));
    return c.body(null, 204);
  });

  // The Game's own Theme, overriding its Organization's part by part (null hands a part back to it).
  /** The Host or a Co-host changes the Game's name, turn timer or who adds the Players; every screen updates. */
  app.patch("/api/games/:id/options", access.need("staff", "Only the Host and Co-hosts can change this Game"), async (c) => {
    const { id } = c.var.access;
    const body = await parseBody(c, gameOptionsEdit);
    if (!body.ok) return body.res;
    const { name, tagline, whenWhere, turnSeconds, rosterMode, approveNames, postsPerMinute, repitchMinutes } = body.data;
    const counted = { turnSeconds, rosterMode, approveNames, postsPerMinute, repitchMinutes };
    const game = store.change(id, (was) => {
      for (const [option, value] of Object.entries(counted))
        if (value !== undefined && value !== was[option as keyof typeof counted]) stats.optionChanged(id, option);
      return { name, tagline, whenWhere, ...counted };
    })!;
    return c.json(view(id, game, now()));
  });

  app.patch("/api/games/:id/theme", access.need("staff", "Only the Host and Co-hosts can change the Game's look"), async (c) => {
    const { id } = c.var.access;
    const body = await parseBody(c, gameThemeEdit);
    if (!body.ok) return body.res;
    const { color, page } = body.data;
    const game = store.change(id, () => ({ own: { color, page } }))!;
    if (color !== undefined || page !== undefined) stats.noteFeature(id, "ownLook");
    return c.json(view(id, game, now()).theme);
  });

  // The Host or a Co-host opens the Worst Gift Vote once the Game has ended, and closes it to reveal the results.
  app.post("/api/games/:id/vote/status", access.need("staff", "Only the Host and Co-hosts can run the vote"), async (c) => {
    const { id } = c.var.access;
    const body = await parseBody(c, voteStatusBody);
    if (!body.ok) return body.res;
    // Decided on the latest copy of the Game, in the same step as the change, so no ballot slips in between.
    let refusal: Response | undefined;
    const { status, winner: picked } = body.data;
    store.change(id, (game) => {
      if (status === "open") {
        if (phase(game.state) !== "ended") return (refusal = c.json({ code: "GameNotOver", message: "End the Game before the vote" }, 409)), null;
        return { vote: { status: "open", winner: null } };
      }
      if (game.vote.status !== "open") return (refusal = c.json({ code: "VoteNotOpen", message: "The vote isn't open" }, 409)), null;
      const counts = tally(game.vote.ballots);
      const most = Math.max(0, ...Object.values(counts));
      // In the order the Gifts were opened, so the Host sees them as they remember them.
      const tied = most === 0 ? [] : gifts(game.state).map((g) => g.id).filter((g) => counts[g] === most);
      if (picked !== undefined && !tied.includes(picked)) return (refusal = c.json({ error: "That Gift isn't one with the most votes" }, 400)), null;
      if (tied.length > 1 && picked === undefined) {
        return (refusal = c.json({ code: "Tie", message: "Gifts are tied for most votes: pick the winner", tied }, 409)), null;
      }
      return { vote: { status: "closed", winner: picked ?? tied[0] ?? null } };
    });
    return refusal ?? c.body(null, 204);
  });

  // The Host switches the big screen between the Gift board, the rules, the join code and the catalog.
  app.post("/api/games/:id/screen", access.need("staff", "Only the Host and Co-hosts can switch the big screen"), async (c) => {
    const { id } = c.var.access;
    const body = await parseBody(c, screenModeBody);
    if (!body.ok) return body.res;
    store.change(id, () => ({ screen: body.data.mode }));
    stats.noteFeature(id, `screen:${body.data.mode}`);
    return c.body(null, 204);
  });

  app.post("/api/games/:id/vote/display", access.need("staff", "Only the Host and Co-hosts can run the vote"), async (c) => {
    const { id } = c.var.access;
    const body = await parseBody(c, voteDisplayBody);
    if (!body.ok) return body.res;
    store.change(id, () => ({ vote: { display: body.data.display } }));
    return c.body(null, 204);
  });

  // Casting or moving this person's one vote.
  app.post("/api/games/:id/vote", access.need("signedIn", "Sign in to vote"), async (c) => {
    const { id } = c.var.access;
    const email = c.var.access.email!;
    const body = await parseBody(c, voteBody);
    if (!body.ok) return body.res;
    // Checked and cast in one step, so the vote can't close in between.
    const game = load(id)!;
    if (game.vote.status !== "open") return c.json({ code: "VoteNotOpen", message: "The vote isn't open" }, 409);
    const { giftId } = body.data;
    if (!gifts(game.state).some((g) => g.id === giftId)) return c.json({ error: "No such Gift in this Game" }, 400);
    store.castBallot(id, email, giftId);
    return c.json({ myVote: giftId });
  });

  app.post("/api/games/:id/moderation", access.need("staff", "Only the Host and Co-hosts can moderate this Game"), async (c) => {
    const { id } = c.var.access;
    const body = await parseBody(c, moderationBody);
    if (!body.ok) return body.res;
    store.change(id, (game) => {
      if (body.data.mode !== game.moderation) stats.optionChanged(id, "moderation");
      return { moderation: body.data.mode };
    });
    return c.body(null, 204);
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

  /** How this server is doing (see system.ts). */
  function health(): ServerHealth {
    const rooms = io?.sockets.adapter.rooms;
    const socketIds = io?.sockets.adapter.sids;
    // Every screen is in a room named by its own id, as well as its Game's; count only the Games'.
    const gamesWatched = rooms && socketIds ? [...rooms.keys()].filter((room) => !socketIds.has(room)).length : 0;
    return {
      tag: serverTag,
      build: build ?? null,
      commit: commit ?? null,
      up: true,
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
      screens: io?.engine.clientsCount ?? 0,
      peakScreens,
      gamesWatched,
      gamesInMemory: store.size(),
      lagMs: lagMs === null ? null : Math.round(lagMs * 10) / 10,
      busy: tooBusy(),
      limits: { maxScreens: overload.maxScreens ?? null, maxLagMs: overload.maxLagMs ?? null },
      memory: { rssBytes: process.memoryUsage.rss(), limitBytes: memoryLimit() },
      disk: diskOf(photosRoot),
      photoBytes: photos.bytes(),
      lastBackupAt: lastBackupAt(backupsDir),
    };
  }

  // The admin pages' routes (admin-routes.ts); only for ADMIN_EMAILS, checked just above.
  app.route("/", adminRoutes({ db, now, load: (id) => load(id)!, stats, said, health, signInEmailCap: linkLimits.perDay, photoBytes: () => photos.bytes(), deleteGame, visitorDays: visitors.lastDays, store, themeImages }));

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
      // A visitor, for the statistics; not Jim (or another admin) checking them.
      if (!isAdmin(signedInAs(c)))
        visitors.arrived({ ip: clientIp(c), userAgent: c.req.header("user-agent") ?? "", path: c.req.path, ref: cleanRef(c.req.query("ref")) ?? undefined });
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
  /**
   * Lets go of the Games (and Feeds) kept in memory that nobody has asked for in IDLE_GAME_HOURS and no screen is
   * watching. Over a busy December that's thousands of finished parties; one opened again is simply rebuilt from
   * the database. Returns how many were let go.
   */
  function forgetIdleGames(): number {
    const before = now().getTime() - IDLE_GAME_HOURS * 60 * 60_000;
    return lifecycle.forgetIdle(before, (id) => (io?.sockets.adapter.rooms.get(id)?.size ?? 0) > 0);
  }

  /** Lets go of demo visitors (and their demo Games) after VISITOR_DAYS. Returns how many visitors went. */
  function sweepVisitors(): number {
    const cutoff = new Date(now().getTime() - VISITOR_DAYS * 24 * 60 * 60_000);
    const gone = db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(like(users.email, `%@${VISITOR_DOMAIN}`), lte(users.createdAt, cutoff)))
      .all();
    for (const visitor of gone) {
      const hosted = db.select({ gameId: gameHosts.gameId }).from(gameHosts).where(eq(gameHosts.email, visitor.email)).all();
      for (const { gameId } of hosted) deleteGame(gameId);
      db.delete(sessions).where(eq(sessions.userId, visitor.id)).run();
      db.delete(users).where(eq(users.id, visitor.id)).run();
    }
    return gone.length;
  }

  /** Clears out what's kept only for a while: old sign-in records, Photos past their time, demo visitors, Games nobody's using. */
  function sweep() {
    return { ...auth.sweep(), photos: sweepPhotos(), visitors: sweepVisitors(), visitorDays: visitors.sweep(), gamesForgotten: forgetIdleGames() };
  }

  /** Serves HTTP and live updates on one port (0 picks a free one). Screens only listen; moves go over HTTP. */
  function listen(port: number): Promise<{ port: number; close: () => Promise<void> }> {
    sweep();
    const sweeping = setInterval(() => {
      sweep();
      void followUps();
    }, 60 * 60_000);
    sweeping.unref(); // never what keeps the process alive
    // How far behind the event loop runs: busy above maxLagMs, and not again until it's back under half that.
    const delay = monitorEventLoopDelay({ resolution: 20 });
    // Measured always, for the System page; it only turns new Games away when overload.maxLagMs is set.
    delay.enable();
    const watchingLag = setInterval(() => {
      const p99 = delay.percentile(99) / 1e6;
      delay.reset();
      lagMs = p99;
      const maxLagMs = overload.maxLagMs;
      if (maxLagMs === undefined) return;
      if (!lagging && p99 > maxLagMs) console.warn(`Busy: the event loop is ${Math.round(p99)} ms behind; new Games wait`);
      lagging = lagging ? p99 > maxLagMs / 2 : p99 > maxLagMs;
    }, 5_000);
    watchingLag.unref();
    return new Promise((resolve) => {
      const http = serve({ fetch: app.fetch, port }, (info: AddressInfo) => {
        resolve({
          port: info.port,
          // Stops taking requests, then closes the database, which folds SQLite's side file (-wal) back into it.
          close: async () => {
            clearInterval(sweeping);
            clearInterval(watchingLag);
            delay.disable();
            delay.disable();
            feed.stop();
            await new Promise<void>((done) => sockets.close(() => done()));
            db.$client.close();
          },
        });
      });
      const sockets = new SocketServer(http);
      io = sockets;

      // A screen names its Game in the connection's URL (?game=), where Caddy can see it to route by Game; pages
      // loaded before that change name it in the handshake's auth instead.
      const gameOf = (socket: { handshake: { query: Record<string, unknown>; auth: Record<string, unknown> } }): unknown =>
        socket.handshake.query["game"] ?? socket.handshake.auth["gameId"];
      sockets.use((socket, next) => {
        const gameId = gameOf(socket);
        if (typeof gameId !== "string" || !load(gameId)) return next(new Error("Game not found"));
        next();
      });
      // On every connection, including a phone waking and reconnecting, send the whole Game.
      sockets.on("connection", (socket) => {
        const gameId = gameOf(socket) as string;
        void socket.join(gameId);
        stats.notePeakScreens(gameId, sockets.sockets.adapter.rooms.get(gameId)?.size ?? 1);
        peakScreens = Math.max(peakScreens, sockets.engine.clientsCount);
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
