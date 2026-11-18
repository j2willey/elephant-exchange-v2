import { createHmac, randomBytes } from "node:crypto";
import { and, asc, count, eq, isNotNull, sql } from "drizzle-orm";
import {
  appKeys,
  gameEvents,
  gameHosts,
  gamePlayers,
  games,
  gameStats,
  organizations,
  orgStats,
  peopleStats,
  posts,
  refVisits,
  users,
  votes,
  type Db,
} from "./db.js";

/** A gap between moves longer than this is a break (dinner, speeches), not play. */
export const BREAK_MS = 30 * 60_000;

/** A Game that really ran: started, with enough Players and Picks to be more than a try-out. */
export const PLAYED = { players: 4, picks: 3 } as const;

/** Addresses nobody can really have: the smoke test's, and Claude's on Jim's behalf. */
export const isTestEmail = (email: string) => /@example\.com$/i.test(email.trim());

/** A ?ref= source as kept: lowercase letters, digits, - and _, up to 32; anything else isn't one. */
export function cleanRef(ref: unknown): string | null {
  return typeof ref === "string" && /^[a-z0-9_-]{1,32}$/i.test(ref) ? ref.toLowerCase() : null;
}

const PICKS = new Set(["GiftOpened", "GiftStolen", "ReturnedGiftTaken", "GiftKept"]);

export interface StatsSummary {
  totals: {
    /** People who hosted at least one played Game. */
    hosts: number;
    /** People who created at least one Game, played or not. */
    hostsWhoCreated: number;
    organizations: number;
    gamesCreated: number;
    gamesPlayed: number;
    gamesFinished: number;
    /** Everyone who ever signed in (Hosts and guests), counted once each. */
    people: number;
    /** Players across played Games: those added by name as well as those on their own phones. */
    players: number;
    signedInPlayers: number;
    /** Over finished Games: from the first Pick to End Game, and the same leaving out breaks. */
    averageMinutes: number | null;
    averageActiveMinutes: number | null;
  };
  /** Each Host of a played Game; `email` is null once they're no longer a user. */
  hosts: { email: string | null; games: number; averageMinutes: number | null }[];
  organizations: { name: string; deleted: boolean; games: number }[];
  sources: { ref: string; visits: number; signUps: number }[];
  games: {
    id: string;
    name: string;
    host: string | null;
    createdAt: string;
    firstPickAt: string | null;
    endedAt: string | null;
    minutes: number | null;
    activeMinutes: number | null;
    players: number;
    picks: number;
    steals: number;
    demo: boolean;
    test: boolean;
    excluded: boolean;
    deleted: boolean;
    played: boolean;
    counted: boolean;
  }[];
}

/** Usage statistics (ADR-0005): kept apart from the Games themselves, so they outlive deletes. */
export function createStats(db: Db, now: () => Date) {
  let secret = db.select().from(appKeys).where(eq(appKeys.name, "stats")).get()?.value;
  if (!secret) {
    secret = randomBytes(32).toString("base64url");
    db.insert(appKeys).values({ name: "stats", value: secret }).onConflictDoNothing().run();
    secret = db.select().from(appKeys).where(eq(appKeys.name, "stats")).get()!.value;
  }
  const key = secret;
  /** A person in the statistics: the same for the same email, and no way back to it without the app's key. */
  const keyOf = (email: string) => createHmac("sha256", key).update(email.trim().toLowerCase()).digest("base64url");

  /** Brings a Game's row up to date from its log; `deleting`: it's about to go, so this is its last word. */
  function snapshotGame(gameId: string, deleting = false) {
    const game = db.select().from(games).where(eq(games.id, gameId)).get();
    if (!game) return;
    const host = db
      .select({ email: gameHosts.email })
      .from(gameHosts)
      .where(and(eq(gameHosts.gameId, gameId), eq(gameHosts.role, "host")))
      .get()?.email;
    const log = db
      .select({ event: gameEvents.event, at: gameEvents.createdAt })
      .from(gameEvents)
      .where(eq(gameEvents.gameId, gameId))
      .orderBy(asc(gameEvents.seq))
      .all()
      .map((e) => ({ type: (JSON.parse(e.event) as { type: string }).type, at: e.at.getTime() }));

    let players = 0;
    let picks = 0;
    let steals = 0;
    let finalRound = false;
    let firstPickAt: number | null = null;
    let endedAt: number | null = null;
    for (const { type, at } of log) {
      if (type === "PlayerAdded") players++;
      if (type === "PlayerRemoved") players--;
      if (PICKS.has(type)) {
        picks++;
        firstPickAt ??= at;
      }
      if (type === "PickUndone") picks--;
      if (type === "GiftStolen") steals++;
      if (type === "FinalRoundStarted") finalRound = true;
      if (type === "GameEnded") endedAt = at;
    }
    // Play time: the moves from the first Pick on, less any break.
    let activeMs = 0;
    const playing = firstPickAt === null ? [] : log.filter((e) => e.at >= firstPickAt! && (endedAt === null || e.at <= endedAt));
    for (let i = 1; i < playing.length; i++) {
      const gap = playing[i]!.at - playing[i - 1]!.at;
      if (gap <= BREAK_MS) activeMs += gap;
    }

    const counted = (table: typeof gamePlayers | typeof votes, where = eq(table.gameId, gameId)) =>
      db.select({ n: count() }).from(table).where(where).get()!.n;
    const postCount = db.select({ n: count() }).from(posts).where(eq(posts.gameId, gameId)).get()!.n;
    const photoCount = db.select({ n: count() }).from(posts).where(and(eq(posts.gameId, gameId), isNotNull(posts.photoWidth))).get()!.n;
    const cohosts = db
      .select({ n: count() })
      .from(gameHosts)
      .where(and(eq(gameHosts.gameId, gameId), eq(gameHosts.role, "cohost")))
      .get()!.n;
    const before = db.select().from(gameStats).where(eq(gameStats.gameId, gameId)).get();
    const at = now();
    const row = {
      name: game.name,
      hostKey: keyOf(host ?? ""),
      orgId: game.orgId,
      demo: game.demo,
      test: host === undefined || isTestEmail(host),
      createdAt: game.createdAt,
      firstPickAt: firstPickAt === null ? null : new Date(firstPickAt),
      endedAt: endedAt === null ? null : new Date(endedAt),
      lastMoveAt: log.length ? new Date(log.at(-1)!.at) : null,
      activeMs,
      players,
      signedInPlayers: counted(gamePlayers),
      picks,
      steals,
      finalRound,
      // Old Photos are swept away after a while (and their Posts with them): what was shared still counts.
      posts: Math.max(postCount, before?.posts ?? 0),
      photos: Math.max(photoCount, before?.photos ?? 0),
      votes: counted(votes),
      cohosts,
      updatedAt: at,
      ...(deleting ? { deletedAt: at } : {}),
    };
    db.insert(gameStats)
      .values({ gameId, ...row })
      .onConflictDoUpdate({ target: gameStats.gameId, set: row })
      .run();
  }

  /** Someone signed in: counted once, ever; `ref` is kept only from their first time. */
  function recordPerson(email: string, at: Date, ref: string | null = null) {
    db.insert(peopleStats)
      .values({ personKey: keyOf(email), firstSeenAt: at, lastSeenAt: at, ref, test: isTestEmail(email) })
      .onConflictDoUpdate({ target: peopleStats.personKey, set: { lastSeenAt: sql`max(${peopleStats.lastSeenAt}, ${at.getTime()})` } })
      .run();
  }

  function recordOrg(orgId: string) {
    const org = db.select().from(organizations).where(eq(organizations.id, orgId)).get();
    if (!org) return;
    const row = { name: org.name, organizerKey: keyOf(org.organizerEmail), test: isTestEmail(org.organizerEmail), createdAt: org.createdAt };
    db.insert(orgStats)
      .values({ orgId, ...row })
      .onConflictDoUpdate({ target: orgStats.orgId, set: { name: row.name } })
      .run();
  }

  /** Before an Organization is deleted. */
  function orgDeleted(orgId: string) {
    recordOrg(orgId);
    db.update(orgStats).set({ deletedAt: now() }).where(eq(orgStats.orgId, orgId)).run();
  }

  /** A browser arrived from a ?ref= link (each browser says so once per source). */
  function recordVisit(ref: string) {
    const day = now().toISOString().slice(0, 10);
    db.insert(refVisits)
      .values({ day, ref, visits: 1 })
      .onConflictDoUpdate({ target: [refVisits.day, refVisits.ref], set: { visits: sql`${refVisits.visits} + 1` } })
      .run();
  }

  /** Brings every row up to date from what's there now: also the backfill for what came before the statistics. */
  function refresh() {
    for (const { id } of db.select({ id: games.id }).from(games).all()) snapshotGame(id);
    for (const { id } of db.select({ id: organizations.id }).from(organizations).all()) recordOrg(id);
    for (const u of db.select().from(users).all()) {
      db.insert(peopleStats)
        .values({ personKey: keyOf(u.email), firstSeenAt: u.createdAt, lastSeenAt: u.lastSignInAt ?? u.createdAt, test: isTestEmail(u.email) })
        .onConflictDoNothing()
        .run();
    }
  }

  /** Leaves a Game out of the statistics, or puts it back. False if there's no such Game in them. */
  function setExcluded(gameId: string, excluded: boolean): boolean {
    snapshotGame(gameId); // it may not have a row yet
    return db.update(gameStats).set({ excluded }).where(eq(gameStats.gameId, gameId)).run().changes > 0;
  }

  function summary(): StatsSummary {
    const emailOf = new Map(db.select({ email: users.email }).from(users).all().map((u) => [keyOf(u.email), u.email]));
    const minutes = (ms: number) => Math.round(ms / 6000) / 10;
    const average = (xs: number[]) => (xs.length ? minutes(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

    const rows = db.select().from(gameStats).all();
    const shown = rows.map((g) => {
      const played = g.firstPickAt !== null && g.players >= PLAYED.players && g.picks >= PLAYED.picks;
      const length = g.firstPickAt && g.endedAt ? g.endedAt.getTime() - g.firstPickAt.getTime() : null;
      return { g, played, real: !g.demo && !g.test && !g.excluded, length };
    });
    const real = shown.filter((s) => s.real);
    const counted = real.filter((s) => s.played);
    const finished = counted.filter((s) => s.length !== null);

    const byHost = new Map<string, typeof counted>();
    for (const s of counted) byHost.set(s.g.hostKey, [...(byHost.get(s.g.hostKey) ?? []), s]);

    const orgs = db.select().from(orgStats).where(eq(orgStats.test, false)).all();
    const people = db.select().from(peopleStats).where(eq(peopleStats.test, false)).all();
    const visits = db
      .select({ ref: refVisits.ref, visits: sql<number>`sum(${refVisits.visits})` })
      .from(refVisits)
      .groupBy(refVisits.ref)
      .all();
    const refs = new Set([...visits.map((v) => v.ref), ...people.flatMap((p) => (p.ref ? [p.ref] : []))]);

    return {
      totals: {
        hosts: byHost.size,
        hostsWhoCreated: new Set(real.map((s) => s.g.hostKey)).size,
        organizations: orgs.length,
        gamesCreated: real.length,
        gamesPlayed: counted.length,
        gamesFinished: finished.length,
        people: people.length,
        players: counted.reduce((n, s) => n + s.g.players, 0),
        signedInPlayers: counted.reduce((n, s) => n + s.g.signedInPlayers, 0),
        averageMinutes: average(finished.map((s) => s.length!)),
        averageActiveMinutes: average(finished.map((s) => s.g.activeMs)),
      },
      hosts: [...byHost]
        .map(([hostKey, mine]) => ({
          email: emailOf.get(hostKey) ?? null,
          games: mine.length,
          averageMinutes: average(mine.flatMap((s) => (s.length === null ? [] : [s.length]))),
        }))
        .sort((a, b) => b.games - a.games),
      organizations: orgs
        .map((o) => ({ name: o.name, deleted: o.deletedAt !== null, games: counted.filter((s) => s.g.orgId === o.orgId).length }))
        .sort((a, b) => b.games - a.games),
      sources: [...refs]
        .map((ref) => ({ ref, visits: visits.find((v) => v.ref === ref)?.visits ?? 0, signUps: people.filter((p) => p.ref === ref).length }))
        .sort((a, b) => b.visits - a.visits),
      games: shown
        .sort((a, b) => b.g.createdAt.getTime() - a.g.createdAt.getTime())
        .map(({ g, played, real: isReal, length }) => ({
          id: g.gameId,
          name: g.name,
          host: emailOf.get(g.hostKey) ?? null,
          createdAt: g.createdAt.toISOString(),
          firstPickAt: g.firstPickAt?.toISOString() ?? null,
          endedAt: g.endedAt?.toISOString() ?? null,
          minutes: length === null ? null : minutes(length),
          activeMinutes: g.firstPickAt ? minutes(g.activeMs) : null,
          players: g.players,
          picks: g.picks,
          steals: g.steals,
          demo: g.demo,
          test: g.test,
          excluded: g.excluded,
          deleted: g.deletedAt !== null,
          played,
          counted: isReal && played,
        })),
    };
  }

  return { snapshotGame, recordPerson, recordOrg, orgDeleted, recordVisit, refresh, setExcluded, summary };
}
