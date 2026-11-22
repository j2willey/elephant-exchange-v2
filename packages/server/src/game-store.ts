import { activePlayers, decide, evolve, newGame, type Command, type DrawFn, type Event, type GameSettings, type GameState, type RuleError } from "@elephant/rules";
import { and, asc, eq } from "drizzle-orm";
import { gameEvents, games, turnClocks, votes, type Db, type Tx } from "./db.js";

/** A Theme's parts, each null when unset: colors as "#rrggbb", images as the version of the stored file. */
export interface ThemeParts {
  color: string | null;
  page: string | null;
  logo: string | null;
  background: string | null;
}

export type OrgTheme = ThemeParts & { id: string; name: string };

/** A Game as the server holds it: what's stored alongside the log, its state rebuilt from the log, and the log's length. */
export interface LoadedGame {
  name: string;
  /** Made with "Try a demo game": its Host console offers the demo view. */
  demo: boolean;
  /** The line under the name; "" for none. */
  tagline: string;
  rosterMode: "host" | "self";
  moderation: "open" | "approval" | "paused";
  approveNames: boolean;
  turnSeconds: number;
  /** Against flooding the Feed: the most Posts a guest makes in a minute, and minutes between sending a Pitch again. */
  postsPerMinute: number;
  repitchMinutes: number;
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
  screen: "gifts" | "rules" | "qr" | "catalog" | "highlights";
  vote: {
    status: "none" | "open" | "closed";
    display: "live" | "hidden" | "parade";
    winner: string | null;
    /** Each voter's Gift, by email. Never sent as is: screens get counts, and each person their own vote. */
    ballots: ReadonlyMap<string, string>;
  };
}

/** Each part optional, and `undefined` the same as left out. */
type Optional<T> = { [K in keyof T]?: T[K] | undefined };

/** What a change to a Game's settings may set, in the Game's own terms. Anything left out (or undefined) stays as it is. */
export type GamePatch = Optional<{
  name: string;
  tagline: string;
  rosterMode: LoadedGame["rosterMode"];
  moderation: LoadedGame["moderation"];
  approveNames: boolean;
  turnSeconds: number;
  postsPerMinute: number;
  repitchMinutes: number;
  screen: LoadedGame["screen"];
  vote: Optional<Pick<LoadedGame["vote"], "status" | "display" | "winner">>;
  /** The Game's own Theme parts. */
  own: Optional<ThemeParts>;
  /** Which Organization's Theme the Game shows; null for none. */
  orgId: string | null;
}>;

type GameRow = typeof games.$inferInsert;

/** The one place a patch becomes columns of the Game's row: the row and the copy in memory must agree. */
function columnsOf(patch: GamePatch): Partial<GameRow> {
  const set: Partial<GameRow> = {};
  const plain = ["name", "tagline", "rosterMode", "moderation", "approveNames", "turnSeconds", "postsPerMinute", "repitchMinutes"] as const;
  for (const key of plain) if (patch[key] !== undefined) Object.assign(set, { [key]: patch[key] });
  if (patch.screen !== undefined) set.screenMode = patch.screen;
  if (patch.vote?.status !== undefined) set.voteStatus = patch.vote.status;
  if (patch.vote?.display !== undefined) set.voteDisplay = patch.vote.display;
  if (patch.vote?.winner !== undefined) set.voteWinner = patch.vote.winner;
  if (patch.own?.color !== undefined) set.themeColor = patch.own.color;
  if (patch.own?.page !== undefined) set.themePage = patch.own.page;
  if (patch.own?.logo !== undefined) set.themeLogo = patch.own.logo;
  if (patch.own?.background !== undefined) set.themeBackground = patch.own.background;
  if (patch.orgId !== undefined) set.orgId = patch.orgId;
  return set;
}

/** The same patch applied to the copy in memory. */
function applied(game: LoadedGame, patch: GamePatch, org: OrgTheme | null | undefined): LoadedGame {
  const { vote, own, orgId: _orgId, ...plain } = patch;
  const defined = Object.fromEntries(Object.entries(plain).filter(([, v]) => v !== undefined));
  const ownParts = Object.fromEntries(Object.entries(own ?? {}).filter(([, v]) => v !== undefined));
  const voteParts = Object.fromEntries(Object.entries(vote ?? {}).filter(([, v]) => v !== undefined));
  return {
    ...game,
    ...defined,
    vote: { ...game.vote, ...voteParts },
    theme: { org: org === undefined ? game.theme.org : org, own: { ...game.theme.own, ...ownParts } },
  };
}

/**
 * The Game store: every Game a request asks for, kept in memory once rebuilt from its log, and every change to one.
 *
 * Its methods are synchronous from start to finish and always start from the latest copy, so two requests never
 * build on the same copy. Each change writes the database and the copy in memory together, then announces the
 * Game's new copy to every `onChange` listener, once.
 */
export function createGameStore(deps: {
  db: Db;
  now: () => Date;
  draw: DrawFn;
  /** An Organization's Theme as it stands; null if there's no such Organization. */
  orgTheme: (orgId: string) => OrgTheme | null;
}) {
  const { db, now, draw, orgTheme } = deps;
  /** Rebuilt Games, so a Game's log is replayed only once per server start. */
  const cache = new Map<string, LoadedGame>();
  /** When each Game was last asked for, so ones nobody's using can be let go. */
  const lastUsed = new Map<string, number>();
  const listeners: ((id: string, game: LoadedGame) => void)[] = [];

  function keep(id: string, next: LoadedGame): LoadedGame {
    cache.set(id, next);
    for (const listener of listeners) listener(id, next);
    return next;
  }

  /** The Game as it stands now, or undefined if there's no such Game. */
  function get(id: string): LoadedGame | undefined {
    lastUsed.set(id, now().getTime());
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
      tagline: row.tagline,
      demo: row.demo,
      rosterMode: row.rosterMode,
      moderation: row.moderation,
      approveNames: row.approveNames,
      turnSeconds: row.turnSeconds,
      postsPerMinute: row.postsPerMinute,
      repitchMinutes: row.repitchMinutes,
      clocks: new Map(clocks.map((c) => [c.playerId, c.startedAt.getTime()])),
      state,
      seq: log.length,
    };
    cache.set(id, game);
    return game;
  }

  /**
   * Decides a command against the latest copy, logs its events and announces the Game. `alsoWrite` goes in the
   * same transaction, so what's stored beside the log never disagrees with it. Returns the Game as it now stands,
   * or the rule that refused the command (nothing is written or announced then).
   */
  function command(id: string, cmd: Command, alsoWrite?: (tx: Tx, game: LoadedGame) => void): LoadedGame | RuleError | undefined {
    const game = get(id);
    if (!game) return undefined;
    const result = decide(game.state, cmd, draw);
    if (!Array.isArray(result)) return result;
    const at = now();
    const state = result.reduce(evolve, game.state);
    // The join code has done its job once the Game starts: the big screen turns to the Gifts. Anything else the
    // Host chose for it (the rules, read out at the start) stays.
    const started = game.state.phase === "setup" && state.phase !== "setup";
    const screen = started && game.screen === "qr" ? ("gifts" as const) : game.screen;
    // A Player's clock starts when they're called up (a Victim's too) and goes once they're no longer up.
    const clocks = new Map<string, number>();
    for (const playerId of activePlayers(state)) clocks.set(playerId, game.clocks.get(playerId) ?? at.getTime());
    db.transaction((tx) => {
      result.forEach((event, i) => {
        tx.insert(gameEvents).values({ gameId: id, seq: game.seq + i + 1, event: JSON.stringify(event), createdAt: at }).run();
      });
      tx.delete(turnClocks).where(eq(turnClocks.gameId, id)).run();
      for (const [playerId, ms] of clocks) tx.insert(turnClocks).values({ gameId: id, playerId, startedAt: new Date(ms) }).run();
      if (screen !== game.screen) tx.update(games).set({ screenMode: screen }).where(eq(games.id, id)).run();
      alsoWrite?.(tx, game);
    });
    return keep(id, { ...game, clocks, state, screen, seq: game.seq + result.length });
  }

  /**
   * Changes a Game's settings. `decideChange` gets the latest copy and returns what to change, or null to change
   * nothing (then nothing is written or announced). Returns the Game as it now stands, or undefined if there's no
   * such Game.
   */
  function change(id: string, decideChange: (game: LoadedGame) => GamePatch | null): LoadedGame | undefined {
    const game = get(id);
    if (!game) return undefined;
    const patch = decideChange(game);
    if (!patch) return game;
    const set = columnsOf(patch);
    if (Object.keys(set).length > 0) db.update(games).set(set).where(eq(games.id, id)).run();
    const org = patch.orgId === undefined ? undefined : patch.orgId === null ? null : orgTheme(patch.orgId);
    return keep(id, applied(game, patch, org));
  }

  /** Casts or moves this person's one vote. Undefined if there's no such Game. */
  function castBallot(id: string, email: string, giftId: string): LoadedGame | undefined {
    const game = get(id);
    if (!game) return undefined;
    db.insert(votes).values({ gameId: id, email, giftId }).onConflictDoUpdate({ target: [votes.gameId, votes.email], set: { giftId } }).run();
    return keep(id, { ...game, vote: { ...game.vote, ballots: new Map(game.vote.ballots).set(email, giftId) } });
  }

  /**
   * Restarts the countdown of a Player who's up. Not a Pick: it isn't logged, and the Game's version doesn't
   * change. Undefined if there's no such Game or the Player isn't up.
   */
  function resetClock(id: string, playerId: string): LoadedGame | undefined {
    const game = get(id);
    if (!game?.clocks.has(playerId)) return undefined;
    const at = now();
    db.update(turnClocks).set({ startedAt: at }).where(and(eq(turnClocks.gameId, id), eq(turnClocks.playerId, playerId))).run();
    return keep(id, { ...game, clocks: new Map(game.clocks).set(playerId, at.getTime()) });
  }

  /** After an Organization changes or goes, brings every Game in memory that shows it up to date, and announces each. */
  function orgChanged(orgId: string) {
    const org = orgTheme(orgId);
    for (const [id, game] of cache) if (game.theme.org?.id === orgId) keep(id, { ...game, theme: { ...game.theme, org } });
  }

  /** Lets go of a Game in memory (the database keeps it); the next `get` rebuilds it. */
  function forget(id: string) {
    cache.delete(id);
    lastUsed.delete(id);
  }

  /**
   * Lets go of Games nobody has asked for since `before` and no screen watches. `others` are ids kept elsewhere
   * (such as Feeds) that go by the same rule. Returns every id let go.
   */
  function forgetIdle(before: number, isWatched: (id: string) => boolean, others: Iterable<string> = []): string[] {
    const gone: string[] = [];
    for (const id of new Set([...cache.keys(), ...others])) {
      if ((lastUsed.get(id) ?? 0) > before || isWatched(id)) continue;
      forget(id);
      gone.push(id);
    }
    return gone;
  }

  /** Lets go of every Game in memory, as after a restore. */
  function clear() {
    cache.clear();
  }

  return {
    get,
    command,
    change,
    castBallot,
    resetClock,
    orgChanged,
    forget,
    forgetIdle,
    clear,
    /** How many Games are in memory. */
    size: () => cache.size,
    onChange: (listener: (id: string, game: LoadedGame) => void) => void listeners.push(listener),
  };
}

export type GameStore = ReturnType<typeof createGameStore>;
