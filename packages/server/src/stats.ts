import { createHmac, randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { activePlayers, evolve, newGame, OPTION_NAMES, RECOMMENDED_OPTIONS, type Event, type GameOptions, type GameSettings } from "@elephant/rules";
import {
  appKeys,
  dailyCounts,
  gameFeatures,
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

export interface Insights {
  /** People at each step, Hosts of real Games only after the first. */
  funnel: { step: "signedIn" | "created" | "started" | "finished" | "voted"; people: number }[];
  /** Over played Games. */
  engagement: { averagePlayers: number | null; signedInShare: number | null; averagePeakScreens: number | null };
  gameplay: {
    averageSteals: number | null;
    averageFrozenGifts: number | null;
    finalRoundShare: number | null;
    voteShare: number | null;
    /** Play time per Pick, breaks left out. */
    averageSecondsPerPick: number | null;
    undosPerGame: number | null;
    skipsPerGame: number | null;
  };
  /** How many played Games used each feature. */
  features: { feature: string; games: number }[];
  /** Hosts who ran a second played Game, and all Hosts. */
  returningHosts: { returning: number; hosts: number };
  /** When each played Game's first Pick was, for the page to group by the viewer's own week, weekday and hour. */
  startTimes: string[];
  costs: { signInEmails: { day: string; count: number }[]; signInEmailCap: number; photoBytes: number };
  setup: SetupInsights;
}

/** How Hosts set their Games up, to learn which options deserve to be the recommended ones. */
export interface SetupInsights {
  /** Games created (played or not), by how the options were chosen; `looked`: of those, how many opened the full list. */
  choices: { choice: "recommended" | "customized" | "saved" | "unknown"; games: number; looked: number }[];
  /**
   * Each option: its recommended value; the values Games were created with (all Games created); the values played
   * Games ended up with; and how many played Games changed it after creation.
   */
  options: {
    option: string;
    recommended: string;
    atStart: { value: string; games: number }[];
    atEnd: { value: string; games: number }[];
    changedLater: number;
  }[];
  /** Played Games by their turn timer (as it ended up): how long Turns really took, and how often they outran it. */
  timer: { seconds: number; games: number; turns: number; averageTurnSeconds: number | null; overTimerShare: number | null }[];
}

export type RecordKind = "players" | "longest" | "steals" | "peakScreens" | "photos";

export interface GameRecord {
  record: RecordKind;
  top: {
    id: string;
    name: string;
    host: string | null;
    /** When it was played: its first Pick. */
    playedAt: string;
    value: number;
    players: number;
    /** First Pick to End Game, and the same without breaks; null if it never ended. */
    minutes: number | null;
    activeMinutes: number | null;
  }[];
}

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
  insights: Insights;
  /** The record holders among played Games: the top 5 for each, for "the biggest party so far had 60 Players". */
  records: GameRecord[];
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
    rating: number | null;
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
      .map((e) => {
        const event = JSON.parse(e.event) as { type: string; giftId?: string; playerId?: string; fromPlayerId?: string; settings?: object };
        return { ...event, at: e.at.getTime() };
      });

    let players = 0;
    let picks = 0;
    let steals = 0;
    let finalRound = false;
    let firstPickAt: number | null = null;
    let endedAt: number | null = null;
    let undos = 0;
    let skips = 0;
    const stealsOf = new Map<string, number>();
    const madePicks: { type: string; giftId: string | undefined }[] = [];
    for (const { type, at, giftId } of log) {
      if (type === "PickUndone") {
        undos++;
        // Undo takes back the last Pick: a steal it undoes was never a steal.
        const undone = madePicks.pop();
        if (undone?.type === "GiftStolen") {
          steals--;
          if (undone.giftId) stealsOf.set(undone.giftId, stealsOf.get(undone.giftId)! - 1);
        }
      }
      if (PICKS.has(type)) madePicks.push({ type, giftId });
      if (type === "PlayerSkipped") skips++;
      if (type === "GiftStolen" && giftId) stealsOf.set(giftId, (stealsOf.get(giftId) ?? 0) + 1);
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
    // Each Turn: from being called up (On Deck doesn't count; a Victim is called up by the Steal) to that Player's
    // Pick, as the turn timer runs. Replayed with the rules, so it's whoever the screens showed as up. A Turn that
    // ends without a Pick (a Skip) isn't counted, nor one across a break. An undone Pick's Turn still counts.
    const upSince = new Map<string, number>();
    let turns = 0;
    let turnMs = 0;
    let turnsOverTimer = 0;
    let state = newGame(JSON.parse(game.settings) as GameSettings);
    for (const e of log) {
      const since = PICKS.has(e.type) && e.playerId ? upSince.get(e.playerId) : undefined;
      if (since !== undefined) {
        upSince.delete(e.playerId!);
        if (e.at - since <= BREAK_MS) {
          turns++;
          turnMs += e.at - since;
          if (game.turnSeconds > 0 && e.at - since > game.turnSeconds * 1000) turnsOverTimer++;
        }
      }
      state = evolve(state, e as unknown as Event);
      const up = new Set(activePlayers(state));
      for (const p of upSince.keys()) if (!up.has(p)) upSince.delete(p);
      for (const p of up) if (!upSince.has(p)) upSince.set(p, e.at);
    }
    const rules = log.reduce((r, e) => (e.type === "SettingsChanged" ? { ...r, ...e.settings } : r), JSON.parse(game.settings) as object);
    const options = {
      ...rules,
      turnSeconds: game.turnSeconds,
      rosterMode: game.rosterMode,
      approveNames: game.approveNames,
      moderation: game.moderation,
    } as GameOptions;

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
    const { maxSteals = 0 } = JSON.parse(game.settings) as { maxSteals?: number };
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
      undos,
      skips,
      frozenGifts: maxSteals > 0 ? [...stealsOf.values()].filter((n) => n >= maxSteals).length : 0,
      voteUsed: game.voteStatus !== "none",
      selfSignup: game.rosterMode === "self",
      options: JSON.stringify(options),
      turns,
      turnMs,
      turnsOverTimer,
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

  /** As many screens are watching a Game live as ever have at once, or more. */
  function notePeakScreens(gameId: string, screens: number) {
    if (!db.select({ id: gameStats.gameId }).from(gameStats).where(eq(gameStats.gameId, gameId)).get()) snapshotGame(gameId);
    db.update(gameStats)
      .set({ peakScreens: sql`max(${gameStats.peakScreens}, ${screens})` })
      .where(eq(gameStats.gameId, gameId))
      .run();
  }

  /** A Game was just created: how the Host chose its options, and what they were. */
  function gameCreated(gameId: string, { choice, looked, options }: { choice: string | null; looked: boolean; options: GameOptions }) {
    snapshotGame(gameId);
    db.update(gameStats)
      .set({ startChoice: choice, lookedAtOptions: looked, optionsAtStart: JSON.stringify(options) })
      .where(eq(gameStats.gameId, gameId))
      .run();
  }

  /** The Host or a Co-host changed one of the Game's options after creating it: a sign the one they started with didn't suit. */
  function optionChanged(gameId: string, option: string) {
    noteFeature(gameId, `changed:${option}`);
  }

  /** A Game used a feature its log doesn't show. */
  function noteFeature(gameId: string, feature: string) {
    db.insert(gameFeatures).values({ gameId, feature }).onConflictDoNothing().run();
  }

  /** Adds one to today's count of `name`. */
  function countToday(name: string) {
    const day = now().toISOString().slice(0, 10);
    db.insert(dailyCounts)
      .values({ day, name, count: 1 })
      .onConflictDoUpdate({ target: [dailyCounts.day, dailyCounts.name], set: { count: sql`${dailyCounts.count} + 1` } })
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

  function summary({
    signInEmailCap,
    photoBytes,
    ratings = new Map(),
  }: {
    signInEmailCap: number;
    photoBytes: number;
    /** Each Game's Host rating (1–5), from the feedback. */
    ratings?: ReadonlyMap<string, number>;
  }): StatsSummary {
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

    const share = (n: number, of: number) => (of ? Math.round((n / of) * 1000) / 10 : null);
    const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
    const hostsWhere = (test: (s: (typeof real)[number]) => boolean) => new Set(real.filter(test).map((s) => s.g.hostKey)).size;
    const used = new Map<string, Set<string>>();
    for (const f of db.select().from(gameFeatures).all()) used.set(f.feature, (used.get(f.feature) ?? new Set()).add(f.gameId));
    const countedWith = (test: (s: (typeof counted)[number]) => boolean) => counted.filter(test).length;
    const usedIn = (feature: string) => countedWith((s) => used.get(feature)?.has(s.g.gameId) ?? false);
    const fortnightAgo = new Date(now().getTime() - 13 * 24 * 60 * 60_000).toISOString().slice(0, 10);
    const emails = db
      .select({ day: dailyCounts.day, count: dailyCounts.count })
      .from(dailyCounts)
      .where(and(eq(dailyCounts.name, "signInEmails"), gte(dailyCounts.day, fortnightAgo)))
      .orderBy(desc(dailyCounts.day))
      .all();

    const insights: Insights = {
      funnel: [
        { step: "signedIn", people: people.length },
        { step: "created", people: hostsWhere(() => true) },
        { step: "started", people: hostsWhere((s) => s.g.firstPickAt !== null) },
        { step: "finished", people: hostsWhere((s) => s.g.endedAt !== null && s.g.firstPickAt !== null) },
        { step: "voted", people: hostsWhere((s) => s.g.voteUsed) },
      ],
      engagement: {
        averagePlayers: mean(counted.map((s) => s.g.players)),
        signedInShare: share(
          counted.reduce((n, s) => n + s.g.signedInPlayers, 0),
          counted.reduce((n, s) => n + s.g.players, 0),
        ),
        averagePeakScreens: mean(counted.filter((s) => s.g.peakScreens > 0).map((s) => s.g.peakScreens)),
      },
      gameplay: {
        averageSteals: mean(counted.map((s) => s.g.steals)),
        averageFrozenGifts: mean(counted.map((s) => s.g.frozenGifts)),
        finalRoundShare: share(countedWith((s) => s.g.finalRound), counted.length),
        voteShare: share(countedWith((s) => s.g.voteUsed), counted.length),
        averageSecondsPerPick: mean(counted.filter((s) => s.g.picks > 0).map((s) => Math.round(s.g.activeMs / s.g.picks / 1000))),
        undosPerGame: mean(counted.map((s) => s.g.undos)),
        skipsPerGame: mean(counted.map((s) => s.g.skips)),
      },
      features: [
        { feature: "posts", games: countedWith((s) => s.g.posts > 0) },
        { feature: "photos", games: countedWith((s) => s.g.photos > 0) },
        { feature: "orgTheme", games: countedWith((s) => s.g.orgId !== null) },
        { feature: "ownLook", games: usedIn("ownLook") },
        { feature: "cohosts", games: countedWith((s) => s.g.cohosts > 0) },
        { feature: "selfSignup", games: countedWith((s) => s.g.selfSignup) },
        { feature: "rosterPaste", games: usedIn("rosterPaste") },
        { feature: "pitch", games: usedIn("pitch") },
        { feature: "share", games: usedIn("share") },
        { feature: "screenModes", games: countedWith((s) => ["rules", "qr", "catalog"].some((m) => used.get(`screen:${m}`)?.has(s.g.gameId))) },
      ],
      returningHosts: { returning: [...byHost.values()].filter((mine) => mine.length >= 2).length, hosts: byHost.size },
      startTimes: counted.map((s) => s.g.firstPickAt!.toISOString()),
      costs: { signInEmails: emails, signInEmailCap, photoBytes },
      setup: setupInsights(real, counted, used, share),
    };

    const holders = (record: RecordKind, valueOf: (s: (typeof counted)[number]) => number | null): GameRecord => ({
      record,
      top: counted
        .flatMap((s) => {
          const value = valueOf(s);
          return value === null || value <= 0 ? [] : [{ s, value }];
        })
        // Ties go to the Game that got there first.
        .sort((a, b) => b.value - a.value || a.s.g.firstPickAt!.getTime() - b.s.g.firstPickAt!.getTime())
        .slice(0, 5)
        .map(({ s, value }) => ({
          id: s.g.gameId,
          name: s.g.name,
          host: emailOf.get(s.g.hostKey) ?? null,
          playedAt: s.g.firstPickAt!.toISOString(),
          value,
          players: s.g.players,
          minutes: s.length === null ? null : minutes(s.length),
          activeMinutes: s.length === null ? null : minutes(s.g.activeMs),
        })),
    });
    const records = [
      holders("players", (s) => s.g.players),
      // Play time, breaks left out, of Games that ended: one left open overnight isn't a long party.
      holders("longest", (s) => (s.length === null ? null : minutes(s.g.activeMs))),
      holders("steals", (s) => s.g.steals),
      holders("peakScreens", (s) => s.g.peakScreens),
      holders("photos", (s) => s.g.photos),
    ];

    return {
      insights,
      records,
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
          rating: ratings.get(g.gameId) ?? null,
          demo: g.demo,
          test: g.test,
          excluded: g.excluded,
          deleted: g.deletedAt !== null,
          played,
          counted: isReal && played,
        })),
    };
  }

  function setupInsights(
    real: { g: typeof gameStats.$inferSelect }[],
    counted: { g: typeof gameStats.$inferSelect }[],
    used: Map<string, Set<string>>,
    share: (n: number, of: number) => number | null,
  ): SetupInsights {
    const parse = (json: string | null) => (json ? (JSON.parse(json) as Partial<GameOptions>) : null);
    const tally = (sets: (Partial<GameOptions> | null)[], option: keyof GameOptions) => {
      const n = new Map<string, number>();
      for (const o of sets) if (o && o[option] !== undefined) n.set(String(o[option]), (n.get(String(o[option])) ?? 0) + 1);
      return [...n].map(([value, games]) => ({ value, games })).sort((a, b) => b.games - a.games);
    };
    const atStart = real.map((s) => parse(s.g.optionsAtStart));
    const atEnd = counted.map((s) => parse(s.g.options));
    const byTimer = new Map<number, (typeof counted)[number]["g"][]>();
    for (const { g } of counted) {
      const seconds = parse(g.options)?.turnSeconds;
      if (seconds !== undefined && g.turns > 0) byTimer.set(seconds, [...(byTimer.get(seconds) ?? []), g]);
    }
    return {
      choices: (["recommended", "customized", "saved", "unknown"] as const).map((choice) => {
        const mine = real.filter((s) => (s.g.startChoice ?? "unknown") === choice);
        return { choice, games: mine.length, looked: mine.filter((s) => s.g.lookedAtOptions).length };
      }),
      options: OPTION_NAMES.map((option) => ({
        option,
        recommended: String(RECOMMENDED_OPTIONS[option]),
        atStart: tally(atStart, option),
        atEnd: tally(atEnd, option),
        changedLater: counted.filter((s) => used.get(`changed:${option}`)?.has(s.g.gameId)).length,
      })),
      timer: [...byTimer]
        .sort(([a], [b]) => a - b)
        .map(([seconds, gs]) => {
          const turns = gs.reduce((n, g) => n + g.turns, 0);
          return {
            seconds,
            games: gs.length,
            turns,
            averageTurnSeconds: Math.round(gs.reduce((n, g) => n + g.turnMs, 0) / turns / 100) / 10,
            overTimerShare: seconds > 0 ? share(gs.reduce((n, g) => n + g.turnsOverTimer, 0), turns) : null,
          };
        }),
    };
  }

  return {
    keyOf,
    snapshotGame,
    recordPerson,
    recordOrg,
    orgDeleted,
    recordVisit,
    notePeakScreens,
    noteFeature,
    gameCreated,
    optionChanged,
    countToday,
    refresh,
    setExcluded,
    summary,
  };
}
