import { randomBytes } from "node:crypto";
import { and, between, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { dailyCounts, feedback, feedbackEmails, gameEvents, gameHosts, games, gameStats, users, type Db } from "./db.js";
import { isTestEmail } from "./stats.js";

/** A Host is asked by email a day after their Game ends, until a week after; never twice for one Game. */
export const FOLLOW_UP_AFTER_MS = 24 * 60 * 60_000;
export const FOLLOW_UP_UNTIL_MS = 7 * 24 * 60 * 60_000;
/** Follow-ups never take more than this share of the day's email allowance: sign-in links come first. */
export const FOLLOW_UP_SHARE = 0.5;
/** And never more than this many in one go. */
export const FOLLOW_UP_BATCH = 10;

export type Answer = { rating?: number; again?: "yes" | "maybe" | "no"; thumbs?: "up" | "down"; comment?: string; quoteOk?: boolean; quoteName?: string };
type Row = typeof feedback.$inferSelect;

export interface FeedbackItem {
  id: string;
  kind: Row["kind"];
  game: string | null;
  /** Their email while they're still a user; null after. */
  from: string | null;
  rating: number | null;
  again: Row["again"];
  thumbs: Row["thumbs"];
  comment: string | null;
  /** They said it may be quoted on the website, under this name; and whether Jim has put it there. */
  quoteOk: boolean;
  quoteName: string | null;
  published: boolean;
  at: string;
}

/** A testimonial on the front page: someone's own words, under the name they gave. */
export interface Testimonial {
  quote: string;
  name: string | null;
  kind: "host" | "guest";
  rating: number | null;
}

export interface FeedbackSummary {
  averageRating: number | null;
  ratings: number;
  again: { yes: number; maybe: number; no: number };
  thumbs: { up: number; down: number };
  suggestions: number;
  items: FeedbackItem[];
}

/** What Hosts and guests said (docs/stats-plan.md, Phase 3). `keyOf` is the statistics' hash of an email. */
export function createFeedback(db: Db, now: () => Date, keyOf: (email: string) => string) {
  /** This person's answer about this Game (or null), as a Host or a guest. */
  function mine(gameId: string, email: string, kind: "host" | "guest"): Row | null {
    return db
      .select()
      .from(feedback)
      .where(and(eq(feedback.kind, kind), eq(feedback.gameId, gameId), eq(feedback.personKey, keyOf(email))))
      .get() ?? null;
  }

  /** Records an answer, or changes the one they gave before. */
  function give(gameId: string, email: string, kind: "host" | "guest", answer: Answer) {
    const at = now();
    const before = mine(gameId, email, kind);
    const comment = answer.comment?.trim() || null;
    const quoteOk = Boolean(answer.quoteOk && comment);
    const quoteName = (quoteOk && answer.quoteName?.trim()) || null;
    // Published words stay up only while they're the very words, name and OK Jim approved.
    const published = Boolean(before?.published && quoteOk && before.comment === comment && before.quoteName === quoteName);
    const values = {
      rating: answer.rating ?? null,
      again: answer.again ?? null,
      thumbs: answer.thumbs ?? null,
      comment,
      quoteOk,
      quoteName,
      published,
      updatedAt: at,
    };
    db.insert(feedback)
      .values({ id: randomBytes(12).toString("base64url"), kind, gameId, personKey: keyOf(email), createdAt: at, ...values })
      .onConflictDoUpdate({ target: [feedback.kind, feedback.gameId, feedback.personKey], set: values })
      .run();
  }

  function suggest(email: string, comment: string) {
    const at = now();
    db.insert(feedback)
      .values({ id: randomBytes(12).toString("base64url"), kind: "suggestion", personKey: keyOf(email), comment: comment.trim(), createdAt: at, updatedAt: at })
      .run();
  }

  /** Every Game's Host rating, for the statistics. */
  function hostRatings(): Map<string, number> {
    const rows = db.select({ gameId: feedback.gameId, rating: feedback.rating }).from(feedback).where(eq(feedback.kind, "host")).all();
    return new Map(rows.flatMap((r) => (r.gameId && r.rating ? [[r.gameId, r.rating] as const] : [])));
  }

  function summary(): FeedbackSummary {
    const emailOf = new Map(db.select({ email: users.email }).from(users).all().map((u) => [keyOf(u.email), u.email]));
    const nameOf = new Map(db.select({ id: gameStats.gameId, name: gameStats.name }).from(gameStats).all().map((g) => [g.id, g.name]));
    for (const g of db.select({ id: games.id, name: games.name }).from(games).all()) nameOf.set(g.id, g.name);
    const rows = db.select().from(feedback).orderBy(desc(feedback.updatedAt)).all();
    // Test accounts' answers stay out of the figures, as in the statistics.
    const real = rows.filter((r) => !isTestEmail(emailOf.get(r.personKey) ?? ""));
    const ratings = real.flatMap((r) => (r.kind === "host" && r.rating ? [r.rating] : []));
    const tally = <T extends string>(field: "again" | "thumbs", values: readonly T[]) =>
      Object.fromEntries(values.map((v) => [v, real.filter((r) => r[field] === v).length])) as Record<T, number>;
    return {
      averageRating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
      ratings: ratings.length,
      again: tally("again", ["yes", "maybe", "no"] as const),
      thumbs: tally("thumbs", ["up", "down"] as const),
      suggestions: real.filter((r) => r.kind === "suggestion").length,
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        game: r.gameId ? (nameOf.get(r.gameId) ?? "(deleted Game)") : null,
        from: emailOf.get(r.personKey) ?? null,
        rating: r.rating,
        again: r.again,
        thumbs: r.thumbs,
        comment: r.comment,
        quoteOk: r.quoteOk,
        quoteName: r.quoteName,
        published: r.published,
        at: r.updatedAt.toISOString(),
      })),
    };
  }

  /**
   * Games whose Host should now be asked by email: ended between a day and a week ago, not a demo, hosted by
   * someone who said it's OK to contact them and who hasn't answered yet, and not asked before.
   */
  function dueForFollowUp(cap: number): { gameId: string; name: string; email: string }[] {
    const at = now().getTime();
    const day = now().toISOString().slice(0, 10);
    const sentToday = db
      .select({ n: sql<number>`coalesce(sum(${dailyCounts.count}), 0)` })
      .from(dailyCounts)
      .where(and(eq(dailyCounts.day, day), inArray(dailyCounts.name, ["signInEmails", "feedbackEmails"])))
      .get()!.n;
    const room = Math.min(FOLLOW_UP_BATCH, Math.floor(cap * FOLLOW_UP_SHARE) - sentToday);
    if (room <= 0) return [];

    const ended = db
      .selectDistinct({ gameId: gameEvents.gameId })
      .from(gameEvents)
      .where(and(like(gameEvents.event, '%"type":"GameEnded"%'), between(gameEvents.createdAt, new Date(at - FOLLOW_UP_UNTIL_MS), new Date(at - FOLLOW_UP_AFTER_MS))))
      .all()
      .map((e) => e.gameId);
    if (ended.length === 0) return [];
    const due = db
      .select({ gameId: games.id, name: games.name, email: users.email })
      .from(games)
      .innerJoin(gameHosts, and(eq(gameHosts.gameId, games.id), eq(gameHosts.role, "host")))
      .innerJoin(users, eq(users.email, gameHosts.email))
      .leftJoin(feedbackEmails, eq(feedbackEmails.gameId, games.id))
      .where(and(inArray(games.id, ended), eq(games.demo, false), eq(users.feedbackOk, true), isNull(feedbackEmails.gameId)))
      .all()
      .filter((g) => !isTestEmail(g.email) && !mine(g.gameId, g.email, "host"));
    return due.slice(0, room);
  }

  function followedUp(gameId: string) {
    db.insert(feedbackEmails).values({ gameId, sentAt: now() }).onConflictDoNothing().run();
  }

  /** Jim shows a testimonial on the front page, or takes it down. Only words someone said may be quoted. */
  function setPublished(id: string, published: boolean): boolean {
    const row = db.select().from(feedback).where(eq(feedback.id, id)).get();
    if (!row || (published && !(row.quoteOk && row.comment))) return false;
    db.update(feedback).set({ published }).where(eq(feedback.id, id)).run();
    return true;
  }

  /** What the front page shows: published testimonials, newest first. */
  function testimonials(): Testimonial[] {
    return db
      .select()
      .from(feedback)
      .where(and(eq(feedback.published, true), eq(feedback.quoteOk, true)))
      .orderBy(desc(feedback.updatedAt))
      .all()
      .flatMap((r) =>
        r.comment && r.kind !== "suggestion" ? [{ quote: r.comment, name: r.quoteName, kind: r.kind, rating: r.kind === "host" ? r.rating : null }] : [],
      );
  }

  return { mine, give, suggest, hostRatings, summary, dueForFollowUp, followedUp, setPublished, testimonials };
}
