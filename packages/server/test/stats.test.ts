import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn, tokenFor } from "./support.js";

type Summary = {
  totals: Record<string, number | null>;
  hosts: { email: string | null; games: number; averageMinutes: number | null }[];
  organizations: { name: string; deleted: boolean; games: number }[];
  sources: { ref: string; visits: number; signUps: number }[];
  games: { id: string; name: string; minutes: number | null; activeMinutes: number | null; played: boolean; counted: boolean; deleted: boolean; excluded: boolean }[];
};

async function setup(dbPath = ":memory:") {
  let ms = Date.UTC(2026, 11, 13, 19, 0, 0);
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath, mailer, now: () => new Date(ms), adminEmails: ["boss@willey.test"] });
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

  it("are for the admin only", async () => {
    const { app, as } = await setup();
    expect((await app.request("/api/admin/stats", { headers: { cookie: await as("ann@willey.test") } })).status).toBe(404);
  });
});
