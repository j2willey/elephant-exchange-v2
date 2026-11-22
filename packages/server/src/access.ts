import { and, eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { gameHosts, gamePlayers, type Db } from "./db.js";
import { isVisitor } from "./stats.js";

export const SESSION_COOKIE = "session";
/** Names the made-up Player a demo page's sample phone is (ADR 0004). */
export const DEMO_PLAYER_HEADER = "x-demo-player";
/** The stand-in identity of a made-up Player who has no stand-in email. */
export const DEMO_ACTOR = "demo-player:";

/** The Staff of a Game: its Host and Co-hosts. */
export type Role = "host" | "cohost";

/**
 * Who may use a Game route:
 * - `anyone`: signed out is fine; the Game must exist.
 * - `signedIn`: anyone signed in.
 * - `staff`: the Host or a Co-host.
 * - `host`: the Host only.
 */
export type Need = "anyone" | "signedIn" | "staff" | "host";

/** What a Game route knows once its Need is met. `email` is set for every Need but `anyone`. */
export interface GameAccess<G> {
  id: string;
  /**
   * The Game as it stood when the route was entered. A route that reads its body (or anything else) with `await`
   * and then changes the Game must load it again after that `await`: another request may have changed it meanwhile,
   * and building on this copy would lose that change.
   */
  game: G;
  email: string | undefined;
  role: Role | undefined;
  /** The Player the asker is in this Game, if any. */
  playerId: string | undefined;
}

export type AccessEnv<G> = { Variables: { access: GameAccess<G> } };

const NEED_SIGN_IN = "Sign in first";
const NOT_FOUND = "Game not found";
const STAFF_ONLY = "Only the Host and Co-hosts can do that";
const HOST_ONLY = "Only the Host can do that";

/**
 * Game access: who is asking about a Game, and whether they may.
 *
 * Owns every rule about the asker's identity:
 * - the session cookie;
 * - the demo page's sample phone (ADR 0004): its header is honoured only in a demo Game, only from that Game's
 *   Staff, and only for a Player on its Roster. The request then acts as the Player's stand-in email (so as a
 *   Co-host if the Host made that Player one; never as the Host);
 * - demo visitors (trying it without signing in), who count as not signed in in a real Game.
 *
 * `identify` must run first on every `/api/games/:id` request. `need(level)` then guards a route: signed in (401),
 * then the Game exists (404), then the role (403), always in that order.
 */
export function createAccess<G extends { demo: boolean }>(deps: {
  db: Db;
  sessionEmail: (token: string | undefined) => string | undefined;
  load: (id: string) => G | undefined;
  /** Whether the Player is on the Game's Roster. */
  onRoster: (game: G, playerId: string) => boolean;
}) {
  const { db, sessionEmail, load, onRoster } = deps;
  /** Requests from a demo Game's sample phone, and the identity each one acts as. */
  const demoActors = new WeakMap<Context, string>();
  /** Requests from a demo visitor about a real Game. */
  const strangers = new WeakSet<Context>();

  const roleIn = (gameId: string, email: string): Role | undefined =>
    db.select().from(gameHosts).where(and(eq(gameHosts.gameId, gameId), eq(gameHosts.email, email))).get()?.role;

  const emailOfPlayer = (gameId: string, playerId: string): string | undefined =>
    db
      .select({ email: gamePlayers.email })
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, playerId)))
      .get()?.email;

  /** Who is asking, on any route: the signed-in person, a demo Player's stand-in, or nobody. */
  const emailOf = (c: Context): string | undefined =>
    strangers.has(c) ? undefined : (demoActors.get(c) ?? sessionEmail(getCookie(c, SESSION_COOKIE)));

  function playerOf(gameId: string, email: string, game: G): string | undefined {
    if (email.startsWith(DEMO_ACTOR)) {
      const playerId = email.slice(DEMO_ACTOR.length);
      return onRoster(game, playerId) ? playerId : undefined;
    }
    const row = db
      .select({ playerId: gamePlayers.playerId })
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.email, email)))
      .get();
    return row && onRoster(game, row.playerId) ? row.playerId : undefined;
  }

  const identify: MiddlewareHandler = async (c, next) => {
    const id = c.req.param("id");
    if (id === undefined) return next();
    const session = sessionEmail(getCookie(c, SESSION_COOKIE));
    const playerId = c.req.header(DEMO_PLAYER_HEADER);
    if (playerId !== undefined) {
      const game = load(id);
      if (!session || !game?.demo || !roleIn(id, session) || !onRoster(game, playerId)) {
        return c.json({ error: "Only a demo Game's Host can see it as one of its Players" }, 403);
      }
      demoActors.set(c, emailOfPlayer(id, playerId) ?? DEMO_ACTOR + playerId);
    } else if (isVisitor(session)) {
      const game = load(id);
      if (game && !game.demo) strangers.add(c);
    }
    return next();
  };

  /** Guards a Game route; `refusal` replaces the standard 401 (`signedIn`) or 403 (`staff`, `host`) wording. */
  function need(level: Need, refusal?: string): MiddlewareHandler<AccessEnv<G>> {
    return async (c, next) => {
      const email = emailOf(c);
      if (level !== "anyone" && !email) return c.json({ error: level === "signedIn" ? (refusal ?? NEED_SIGN_IN) : NEED_SIGN_IN }, 401);
      const id = c.req.param("id")!;
      const game = load(id);
      if (!game) return c.json({ error: NOT_FOUND }, 404);
      const role = email ? roleIn(id, email) : undefined;
      if (level === "staff" && !role) return c.json({ error: refusal ?? STAFF_ONLY }, 403);
      if (level === "host" && role !== "host") return c.json({ error: refusal ?? HOST_ONLY }, 403);
      c.set("access", { id, game, email, role, playerId: email ? playerOf(id, email, game) : undefined });
      return next();
    };
  }

  return { identify, need, emailOf, roleIn, playerOf, emailOfPlayer };
}

export type Access<G extends { demo: boolean }> = ReturnType<typeof createAccess<G>>;
