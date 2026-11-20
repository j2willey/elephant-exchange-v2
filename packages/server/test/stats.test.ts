import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn, tokenFor } from "./support.js";

type Summary = {
  totals: Record<string, number | null>;
  insights: {
    funnel: { step: string; people: number }[];
    engagement: Record<string, number | null>;
    gameplay: Record<string, number | null>;
    features: { feature: string; games: number }[];
    returningHosts: { returning: number; hosts: number };
    startTimes: string[];
    costs: { signInEmails: { day: string; count: number }[]; signInEmailCap: number; photoBytes: number };
  };
  hosts: { email: string | null; games: number; averageMinutes: number | null }[];
  organizations: { name: string; deleted: boolean; games: number }[];
  sources: { ref: string; visits: number; signUps: number }[];
  records: { record: string; top: { name: string; value: number; players: number; minutes: number | null; activeMinutes: number | null; host: string | null }[] }[];
  games: { id: string; name: string; minutes: number | null; activeMinutes: number | null; played: boolean; counted: boolean; deleted: boolean; excluded: boolean }[];
};

async function setup(dbPath = ":memory:") {
  let ms = Date.UTC(2026, 11, 13, 19, 0, 0);
  const { sent, mailer } = capturingMailer();
  // Draws in the order Players were added, so a test knows whose turn it is.
  const { app } = createServer({ dbPath, mailer, now: () => new Date(ms), adminEmails: ["boss@willey.test"], draw: (waiting) => waiting[0]! });
  const as = (email: string) => signIn(app, sent, email);
  const admin = await as("boss@willey.test");
  const minutes = (n: number) => (ms += n * 60_000);
  const stats = async () => (await (await app.request("/api/admin/stats", { headers: { cookie: admin } })).json()) as Summary;
  const send = (id: string, cookie: string, cmd: unknown) => app.request(`/api/games/${id}/commands`, post(cmd, cookie));
  const newGame = async (cookie: string, extra: Record<string, unknown> = {}) =>
    ((await (await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 }, ...extra }, cookie))).json()) as { id: string }).id;

  /** A whole party: `players` added, everyone opens a Gift a minute apart (with a dinner break halfway), then it ends. */
  async function party(cookie: string, name: string, players = 4, extra: Record<string, unknown> = {}) {
    const id = await newGame(cookie, { name, ...extra });
    for (let i = 0; i < players; i++) await send(id, cookie, { type: "AddPlayer", playerId: `p${i}`, name: `P${i}` });
    await send(id, cookie, { type: "StartGame" });
    minutes(24 * 60); // set up the day before
    const game = (await (await app.request(`/api/games/${id}`, { headers: { cookie } })).json()) as { active: string[] };
    let up = game.active[0]!;
    for (let i = 0; i < players; i++) {
      minutes(i === Math.floor(players / 2) ? 45 : 1); // a 45-minute dinner break halfway
      await send(id, cookie, { type: "OpenGift", playerId: up, giftId: `g${i}`, name: `Gift ${i}` });
      up = ((await (await app.request(`/api/games/${id}`, { headers: { cookie } })).json()) as { active: string[] }).active[0]!;
    }
    minutes(2);
    await send(id, cookie, { type: "EndGame" });
    return id;
  }
  /** Signs in from a link that came from `ref` (as the web app sends it, from ?ref= on the page they arrived at). */
  async function signInFrom(ref: string, email: string) {
    await app.request("/api/auth/link", post({ email, ref }));
    const res = await app.request("/api/auth/verify", post({ token: tokenFor(sent, email) }));
    expect(res.status).toBe(200);
  }
  return { app, as, admin, minutes, stats, send, newGame, party, signInFrom };
}

describe("Usage statistics", () => {
  it("count a played Game from its first Pick, not from when it was set up, with and without breaks", async () => {
    const { as, stats, party } = await setup();
    await party(await as("ann@willey.test"), "Office party");

    const { totals, games } = await stats();
    expect(totals).toMatchObject({ gamesCreated: 1, gamesPlayed: 1, gamesFinished: 1, hosts: 1, players: 4 });
    // First Pick to End Game: 1 + 1 + 45 (dinner) + 1 more opens = 3 gaps after the first, plus 2 to end.
    const game = games.find((g) => g.name === "Office party")!;
    expect(game.minutes).toBe(1 + 45 + 1 + 2);
    expect(game.activeMinutes).toBe(1 + 1 + 2); // the break left out
    expect(totals.averageMinutes).toBe(49);
  });

  it("outlive deletes: a deleted Game, its Host's departure from the list, and a deleted Organization all still count", async () => {
    const { app, as, stats, party } = await setup();
    const ann = await as("ann@willey.test");
    const lodge = ((await (await app.request("/api/orgs", post({ name: "Lodge 22" }, ann))).json()) as { id: string }).id;
    const id = await party(ann, "Lodge party", 5, { orgId: lodge });

    await app.request(`/api/games/${id}`, { method: "DELETE", headers: { cookie: ann } });
    await app.request(`/api/orgs/${lodge}`, { method: "DELETE", headers: { cookie: ann } });

    const s = await stats();
    expect(s.totals).toMatchObject({ gamesPlayed: 1, organizations: 1, players: 5 });
    expect(s.games.find((g) => g.id === id)).toMatchObject({ deleted: true, counted: true });
    expect(s.organizations).toEqual([{ name: "Lodge 22", deleted: true, games: 1 }]);
    expect(s.hosts).toEqual([{ email: "ann@willey.test", games: 1, averageMinutes: expect.any(Number) }]);
  });

  it("leave out demos, test addresses, try-outs too small to be a party, and Games excluded by hand", async () => {
    const { app, admin, as, stats, party, newGame } = await setup();
    const ann = await as("ann@willey.test");
    await party(ann, "Real party");
    await party(ann, "Demo", 8, { demo: true });
    await party(await as("smoke-1@example.com"), "Smoke");
    await party(ann, "Two of us", 2);
    await newGame(ann, { name: "Next year's" }); // created, never played
    const trial = await party(ann, "Jim's trial");

    expect((await app.request(`/api/admin/stats/games/${trial}`, post({ excluded: true }, admin))).status).toBe(204);

    const { totals, games } = await stats();
    expect(totals).toMatchObject({ gamesPlayed: 1, gamesCreated: 3, hosts: 1, hostsWhoCreated: 1 });
    expect(games.filter((g) => g.counted).map((g) => g.name)).toEqual(["Real party"]);
    expect(games.find((g) => g.name === "Two of us")).toMatchObject({ played: false });
    expect(games.find((g) => g.name === "Jim's trial")).toMatchObject({ excluded: true, counted: false });
  });

  it("count each person once, ever, and keep only a hash of their email, never the address", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "stats-")), "elephant.db");
    const { as, stats } = await setup(dbPath);
    await as("ann@willey.test");
    await as("ann@willey.test");
    await as("bob@willey.test");
    await as("smoke-2@example.com");

    expect((await stats()).totals.people).toBe(3); // Ann, Bob and the admin; not the test address
    const raw = new Database(dbPath, { readonly: true });
    for (const table of ["people_stats", "game_stats", "org_stats", "ref_visits"]) {
      expect(JSON.stringify(raw.prepare(`SELECT * FROM ${table}`).all())).not.toContain("@");
    }
    raw.close();
  });

  it("credit visits and sign-ups to where they came from", async () => {
    const { app, stats, signInFrom } = await setup();
    for (let i = 0; i < 3; i++) await app.request("/api/stats/visit", post({ ref: "LinkedIn" }));
    await app.request("/api/stats/visit", post({ ref: "facebook" }));
    await app.request("/api/stats/visit", post({ ref: "<script>" }));
    await signInFrom("linkedin", "ann@willey.test");
    await signInFrom("facebook", "ann@willey.test"); // her second sign-in: she still came from LinkedIn

    expect((await stats()).sources).toEqual([
      { ref: "linkedin", visits: 3, signUps: 1 },
      { ref: "facebook", visits: 1, signUps: 0 },
    ]);
  });

  it("show where Hosts drop off: signed in, created, started, finished, ran the vote", async () => {
    const { app, as, stats, party, newGame, send } = await setup();
    await as("guest@willey.test"); // signed in, never hosted
    await newGame(await as("cat@willey.test"), { name: "Never started" });
    const ann = await as("ann@willey.test");
    const id = await party(ann, "Ann's party");
    await app.request(`/api/games/${id}/vote/status`, post({ status: "open" }, ann));
    await party(await as("bob@willey.test"), "Bob's party");
    void send;

    expect((await stats()).insights.funnel).toEqual([
      { step: "signedIn", people: 5 }, // with the admin
      { step: "created", people: 3 },
      { step: "started", people: 2 },
      { step: "finished", people: 2 },
      { step: "voted", people: 1 },
    ]);
  });

  it("count steals, frozen Gifts, undos and skips, and play time per Pick", async () => {
    const { as, stats, newGame, send, minutes } = await setup();
    const ann = await as("ann@willey.test");
    const id = await newGame(ann, { name: "Steal fest", settings: { activeSlots: 1, maxSteals: 1 } });
    for (const p of ["a", "b", "c", "d", "e"]) await send(id, ann, { type: "AddPlayer", playerId: p, name: p.toUpperCase() });
    await send(id, ann, { type: "StartGame" });
    const pick = async (cmd: Record<string, unknown>) => {
      minutes(1);
      await send(id, ann, cmd);
    };
    await pick({ type: "OpenGift", playerId: "a", giftId: "g1", name: "Mug" });
    await pick({ type: "Steal", playerId: "b", giftId: "g1" }); // Mug frozen (limit 1)
    await pick({ type: "Undo" });
    await pick({ type: "Steal", playerId: "b", giftId: "g1" });
    await pick({ type: "OpenGift", playerId: "a", giftId: "g2", name: "Socks" });
    await pick({ type: "Skip", playerId: "c" });
    for (const [p, g] of [["d", "g3"], ["e", "g4"], ["c", "g5"]]) await pick({ type: "OpenGift", playerId: p, giftId: g, name: g });
    await send(id, ann, { type: "EndGame" });

    const { gameplay } = (await stats()).insights;
    // The undone steal doesn't count: one steal, which froze the Mug.
    expect(gameplay).toMatchObject({ averageSteals: 1, averageFrozenGifts: 1, undosPerGame: 1, skipsPerGame: 1, voteShare: 0, finalRoundShare: 0 });
    expect(gameplay.averageSecondsPerPick).toBeGreaterThan(0);
  });

  it("count features used, returning Hosts, and sign-in emails a day against the cap", async () => {
    const { app, as, stats, party } = await setup();
    const ann = await as("ann@willey.test");
    const first = await party(ann, "First");
    await app.request(`/api/games/${first}/screen`, post({ mode: "rules" }, ann));
    await app.request(`/api/games/${first}/features`, post({ feature: "rosterPaste" }, ann));
    expect((await app.request(`/api/games/${first}/features`, post({ feature: "anythingElse" }, ann))).status).toBe(400);
    expect((await app.request(`/api/games/${first}/features`, post({ feature: "rosterPaste" }, await as("bob@willey.test")))).status).toBe(403);
    await party(ann, "Second");

    const { insights } = await stats();
    expect(insights.features).toEqual(
      expect.arrayContaining([
        { feature: "screenModes", games: 1 },
        { feature: "rosterPaste", games: 1 },
        { feature: "posts", games: 0 },
      ]),
    );
    expect(insights.returningHosts).toEqual({ returning: 1, hosts: 1 });
    expect(insights.startTimes).toHaveLength(2);
    // The admin, Ann and Bob signed in: three links emailed (the parties ran past midnight, so over two days).
    expect(insights.costs.signInEmails.reduce((n, d) => n + d.count, 0)).toBe(3);
    expect(insights.costs.signInEmailCap).toBe(100);
  });

  it("are for the admin only", async () => {
    const { app, as } = await setup();
    expect((await app.request("/api/admin/stats", { headers: { cookie: await as("ann@willey.test") } })).status).toBe(404);
  });
});

describe("Records", () => {
  it("name the biggest, longest and busiest played Games, top 5 each, leaving out demos, tests and try-outs", async () => {
    const { as, stats, party } = await setup();
    const ann = await as("ann@willey.test");
    for (const [name, players] of [["Small", 4], ["Medium", 8], ["Big", 12], ["Bigger", 16], ["Biggest", 20], ["Huge", 24]] as const) await party(ann, name, players);
    await party(ann, "Demo", 40, { demo: true });
    await party(await as("smoke-9@example.com"), "Smoke", 40);

    const { records } = await stats();
    const players = records.find((r) => r.record === "players")!.top;
    expect(players.map((g) => [g.name, g.value])).toEqual([["Huge", 24], ["Biggest", 20], ["Bigger", 16], ["Big", 12], ["Medium", 8]]);
    expect(players[0]).toMatchObject({ host: "ann@willey.test", players: 24, minutes: expect.any(Number), activeMinutes: expect.any(Number) });
    // Longest: play time without the dinner break; more Players, more minutes of opening.
    const longest = records.find((r) => r.record === "longest")!.top;
    expect(longest[0]).toMatchObject({ name: "Huge", value: longest[0]!.activeMinutes });
    expect(records.map((r) => r.record)).toEqual(["players", "longest", "steals", "peakScreens", "photos"]);
  });
});
