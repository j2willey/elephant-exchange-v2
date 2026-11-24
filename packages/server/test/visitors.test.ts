import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, signIn } from "./support.js";
import { dailyCounts, openDb, visitorDays, visitorsSeen } from "../src/db.js";
import { createVisitors } from "../src/visitors.js";

/** Visitors on a fresh database, with a clock the test moves. */
function setup() {
  const db = openDb(":memory:");
  let at = new Date("2026-11-23T15:00:00Z");
  const visitors = createVisitors({ db, now: () => at });
  const nextDay = () => (at = new Date(at.getTime() + 24 * 60 * 60_000));
  return { db, visitors, nextDay };
}

const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const LAPTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const today = (v: ReturnType<typeof setup>["visitors"]) => v.lastDays(1)[0]!;

describe("Counting visitors", () => {
  it("counts each visitor once a day, however many pages they load", () => {
    const { visitors } = setup();
    expect(visitors.arrived({ ip: "1.2.3.4", userAgent: PHONE, path: "/" })).toBe("visitor");
    expect(visitors.arrived({ ip: "1.2.3.4", userAgent: PHONE, path: "/try" })).toBe("again");
    expect(visitors.arrived({ ip: "1.2.3.4", userAgent: LAPTOP, path: "/" })).toBe("visitor"); // another device there
    expect(visitors.arrived({ ip: "5.6.7.8", userAgent: PHONE, path: "/" })).toBe("visitor");

    expect(today(visitors)).toMatchObject({ visitors: 3 });
  });

  it("says where each visitor first landed, and how many came from a ?ref= link", () => {
    const { visitors } = setup();
    visitors.arrived({ ip: "1.1.1.1", userAgent: PHONE, path: "/" });
    visitors.arrived({ ip: "2.2.2.2", userAgent: PHONE, path: "/about" });
    visitors.arrived({ ip: "3.3.3.3", userAgent: PHONE, path: "/try", ref: "linkedin" });
    visitors.arrived({ ip: "4.4.4.4", userAgent: PHONE, path: "/games/a.xyz" });
    visitors.arrived({ ip: "5.5.5.5", userAgent: PHONE, path: "/login" });
    visitors.arrived({ ip: "1.1.1.1", userAgent: PHONE, path: "/games/a.xyz", ref: "facebook" }); // already counted

    expect(today(visitors)).toMatchObject({ visitors: 5, front: 2, demo: 1, game: 1, other: 1, fromLinks: 1 });
  });

  it("counts link previews and crawlers apart from visitors", () => {
    const { visitors } = setup();
    for (const bot of [
      "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)",
      "",
    ])
      expect(visitors.arrived({ ip: "9.9.9.9", userAgent: bot, path: "/" })).toBe("preview");

    expect(today(visitors)).toMatchObject({ visitors: 0, previews: 6 });
  });

  it("counts someone tapping the link inside the LinkedIn or Facebook app as a visitor", () => {
    const { visitors } = setup();
    const inLinkedIn = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.31.6";
    const inFacebook = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/490.0]";
    expect(visitors.arrived({ ip: "1.1.1.1", userAgent: inLinkedIn, path: "/try", ref: "linkedin" })).toBe("visitor");
    expect(visitors.arrived({ ip: "2.2.2.2", userAgent: inFacebook, path: "/try", ref: "facebook" })).toBe("visitor");
    expect(visitors.arrived({ ip: "3.3.3.3", userAgent: "WhatsApp/2.24.1 A", path: "/" })).toBe("preview");
  });

  it("can't link a visitor across days: a new secret each day, and yesterday's fingerprints and secret are deleted", () => {
    const { db, visitors, nextDay } = setup();
    visitors.arrived({ ip: "1.2.3.4", userAgent: PHONE, path: "/" });
    const [first] = db.select().from(visitorsSeen).all();
    expect(first!.fingerprint).not.toContain("1.2.3.4");

    nextDay();
    expect(visitors.arrived({ ip: "1.2.3.4", userAgent: PHONE, path: "/" })).toBe("visitor"); // counted again
    const [second] = db.select().from(visitorsSeen).all().filter((r) => r.day !== first!.day);
    expect(second!.fingerprint).not.toBe(first!.fingerprint);

    expect(visitors.sweep()).toBe(1);
    expect(db.select().from(visitorsSeen).all().map((r) => r.day)).toEqual([second!.day]);
    expect(db.select().from(visitorDays).all().map((r) => r.day)).toEqual([second!.day]);
    // The day's totals stay.
    expect(db.select().from(dailyCounts).all().filter((r) => r.name === "visitors").map((r) => r.count)).toEqual([1, 1]);
  });

  it("keeps the day's secret across a restart, so nobody is counted twice", () => {
    const { db, visitors } = setup();
    visitors.arrived({ ip: "1.2.3.4", userAgent: PHONE, path: "/" });
    const restarted = createVisitors({ db, now: () => new Date("2026-11-23T20:00:00Z") });
    expect(restarted.arrived({ ip: "1.2.3.4", userAgent: PHONE, path: "/" })).toBe("again");
  });

  it("lists the last days oldest first, with a row for every day even when nobody came", () => {
    const { visitors, nextDay } = setup();
    visitors.arrived({ ip: "1.2.3.4", userAgent: PHONE, path: "/" });
    nextDay();
    nextDay();
    visitors.arrived({ ip: "1.2.3.4", userAgent: PHONE, path: "/" });
    visitors.arrived({ ip: "5.6.7.8", userAgent: PHONE, path: "/" });

    expect(visitors.lastDays(4).map((d) => [d.day, d.visitors])).toEqual([
      ["2026-11-22", 0],
      ["2026-11-23", 1],
      ["2026-11-24", 0],
      ["2026-11-25", 2],
    ]);
  });
});

describe("Visitors, on the server", () => {
  it("counts a browser loading the app's pages, but not an admin checking the stats, and shows them on the Stats page", async () => {
    const webRoot = mkdtempSync(join(tmpdir(), "visitors-web-"));
    writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>Elephant Exchange</title>");
    const { sent, mailer } = capturingMailer();
    const { app } = createServer({ dbPath: ":memory:", mailer, webRoot, adminEmails: ["jim@example.org"] });
    const jim = await signIn(app, sent, "jim@example.org");
    const load = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers: { "user-agent": PHONE, ...headers } });

    expect((await load("/try?ref=linkedin")).status).toBe(200);
    await load("/games/a.xyz"); // the same visitor again
    await load("/", { "user-agent": "LinkedInBot/1.0 (compatible; Mozilla/5.0)" });
    await load("/admin/stats", { cookie: jim });

    const stats = (await (await app.request("/api/admin/stats", { headers: { cookie: jim } })).json()) as { visitors: { visitors: number; demo: number; fromLinks: number; previews: number }[] };
    expect(stats.visitors).toHaveLength(14);
    expect(stats.visitors.at(-1)).toMatchObject({ visitors: 1, demo: 1, fromLinks: 1, previews: 1 });
  });
});
