import { createHmac, randomBytes } from "node:crypto";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { dailyCounts, refVisits, visitorDays, visitorsSeen, type Db } from "./db.js";

/** Where a visitor first landed on a day. */
export type Landing = "front" | "demo" | "game" | "other";

/** One day's visitors, as the admin's Stats page shows them. */
export interface VisitorDay {
  /** YYYY-MM-DD, UTC. */
  day: string;
  /** Different visitors that day (each counted once, wherever they went). */
  visitors: number;
  /** Where they first landed: the front page (or the guide), the demo, a Game's link, anywhere else. */
  front: number;
  demo: number;
  game: number;
  other: number;
  /** Visitors who reached the demo that day (the demo, the guided tour), wherever they landed. */
  triedDemo: number;
  /** Visitors who came from a ?ref= link (a post) that day, on whichever page. */
  fromLinks: number;
  /** Link previews and crawlers (LinkedIn, Facebook, Slack, search engines, uptime checks): not visitors. */
  previews: number;
}

/**
 * Link-preview fetchers, crawlers and monitors, by their own names (LinkedInBot, Slackbot, facebookexternalhit,
 * WhatsApp's preview, …), not by the app they belong to: someone tapping a link in the LinkedIn or Facebook app
 * opens it in that app's own browser, and is a visitor.
 */
const ROBOT = /bot\b|bot\/|crawl|spider|slurp|externalhit|facebookcatalog|whatsapp\/|skypeuripreview|embedly|vkshare|uptime|monitor|headless|python|curl|wget|httpclient|go-http|okhttp|java\//i;

function landingOf(path: string): Landing {
  if (path === "/" || path === "/about" || path === "/guide" || path === "/playbook") return "front";
  if (path === "/try" || path === "/sample" || path.startsWith("/guided/") || /^\/games\/[^/]+\/demo$/.test(path)) return "demo";
  if (path.startsWith("/games/")) return "game";
  return "other";
}

const dayOf = (at: Date) => at.toISOString().slice(0, 10);

/**
 * Unique visitors, without tracking anyone: each page load is reduced to a keyed hash of the visitor's address and
 * browser with the day's secret, enough to count "same visitor today" and nothing more. There's no cookie, nothing
 * that identifies anyone is kept, and since the secret changes every day (yesterday's is deleted along with the
 * day's fingerprints), no visitor can be followed from one day to the next. Only the day's totals are kept.
 * (Plausible counts visitors the same way.) Someone who comes back tomorrow counts again, and visitors behind one
 * address with the same browser count once.
 */
export function createVisitors(deps: { db: Db; now: () => Date }) {
  const { db, now } = deps;

  function secretOf(day: string): string {
    const kept = db.select({ secret: visitorDays.secret }).from(visitorDays).where(eq(visitorDays.day, day)).get();
    if (kept) return kept.secret;
    const secret = randomBytes(32).toString("base64url");
    db.insert(visitorDays).values({ day, secret }).onConflictDoNothing().run();
    return db.select({ secret: visitorDays.secret }).from(visitorDays).where(eq(visitorDays.day, day)).get()!.secret;
  }

  function add(day: string, name: string) {
    db.insert(dailyCounts)
      .values({ day, name, count: 1 })
      .onConflictDoUpdate({ target: [dailyCounts.day, dailyCounts.name], set: { count: sql`${dailyCounts.count} + 1` } })
      .run();
  }

  const isRobot = (userAgent: string) => !userAgent.trim() || ROBOT.test(userAgent);
  const fingerprintOf = (day: string, ip: string, userAgent: string) => createHmac("sha256", secretOf(day)).update(`${ip}\n${userAgent}`).digest("base64url");

  /** True the first time today this visitor does `what` ("" for being here at all). Kept with the day's fingerprints. */
  function firstToday(day: string, fingerprint: string, what: string): boolean {
    const key = what ? `${fingerprint}|${what}` : fingerprint;
    return db.insert(visitorsSeen).values({ day, fingerprint: key }).onConflictDoNothing().run().changes > 0;
  }

  /** Counted once a visitor a day, on whichever page it happens: reaching the demo, coming from a ?ref= link. */
  function note(day: string, fingerprint: string, what: { demo?: boolean | undefined; ref?: string | undefined }) {
    if (what.demo && firstToday(day, fingerprint, "demo")) add(day, "visitors:triedDemo");
    if (what.ref) {
      if (firstToday(day, fingerprint, "link")) add(day, "visitors:fromLinks");
      // Each source once: someone who comes from LinkedIn and then Facebook counts for both.
      if (firstToday(day, fingerprint, `ref:${what.ref}`))
        db.insert(refVisits)
          .values({ day, ref: what.ref, visits: 1 })
          .onConflictDoUpdate({ target: [refVisits.day, refVisits.ref], set: { visits: sql`${refVisits.visits} + 1` } })
          .run();
    }
  }

  /**
   * A browser loaded one of the app's pages. Says whether it was a new visitor today, one already counted, or a
   * robot (a link preview or crawler, counted apart). The first page of the day is where they landed; reaching the
   * demo and a ?ref= count on any page.
   */
  function arrived(visit: { ip: string; userAgent: string; path: string; ref?: string | undefined }): "visitor" | "again" | "preview" {
    const day = dayOf(now());
    if (isRobot(visit.userAgent)) {
      add(day, "previews");
      return "preview";
    }
    const fingerprint = fingerprintOf(day, visit.ip, visit.userAgent);
    const isNew = firstToday(day, fingerprint, "");
    if (isNew) {
      add(day, "visitors");
      add(day, `visitors:${landingOf(visit.path)}`);
    }
    note(day, fingerprint, { demo: landingOf(visit.path) === "demo", ref: visit.ref });
    return isNew ? "visitor" : "again";
  }

  /**
   * What the browser says happened inside the app, where the server sees no page load: it moved to the demo, or it
   * arrived with a ?ref=. The same rules as a page load: once a visitor a day, robots not at all.
   */
  function told(visit: { ip: string; userAgent: string; demo?: boolean | undefined; ref?: string | undefined }) {
    if (isRobot(visit.userAgent)) return;
    const day = dayOf(now());
    note(day, fingerprintOf(day, visit.ip, visit.userAgent), visit);
  }

  /** The last `n` days, oldest first, one row a day (zeros on a day nobody came). */
  function lastDays(n: number): VisitorDay[] {
    const today = now();
    const days = Array.from({ length: n }, (_, i) => dayOf(new Date(today.getTime() - (n - 1 - i) * 24 * 60 * 60_000)));
    const rows = db
      .select({ day: dailyCounts.day, name: dailyCounts.name, count: dailyCounts.count })
      .from(dailyCounts)
      .where(and(gte(dailyCounts.day, days[0]!), sql`(${dailyCounts.name} = 'previews' or ${dailyCounts.name} like 'visitors%')`))
      .all();
    const count = (day: string, name: string) => rows.find((r) => r.day === day && r.name === name)?.count ?? 0;
    return days.map((day) => ({
      day,
      visitors: count(day, "visitors"),
      front: count(day, "visitors:front"),
      demo: count(day, "visitors:demo"),
      game: count(day, "visitors:game"),
      other: count(day, "visitors:other"),
      triedDemo: count(day, "visitors:triedDemo"),
      fromLinks: count(day, "visitors:fromLinks"),
      previews: count(day, "previews"),
    }));
  }

  /** Deletes every earlier day's secret and fingerprints (the totals stay). Returns how many days went. */
  function sweep(): number {
    const today = dayOf(now());
    db.delete(visitorsSeen).where(lt(visitorsSeen.day, today)).run();
    return db.delete(visitorDays).where(lt(visitorDays.day, today)).run().changes;
  }

  return { arrived, told, lastDays, sweep };
}

export type Visitors = ReturnType<typeof createVisitors>;
