import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn, tokenFor } from "./support.js";

const del = (cookie: string) => ({ method: "DELETE", headers: { cookie } });

type Person = { email: string; firstSeen: string; lastSignIn: string | null; feedbackOk: boolean; games: number; demoGames: number; organizations: string[] };
type AdminGame = { id: string; name: string; demo: boolean; host: string; phase: string; players: number; createdAt: string };

async function setup() {
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer, adminEmails: ["boss@willey.test"] });
  const as = (email: string) => signIn(app, sent, email);
  const newGame = async (cookie: string, extra: Record<string, unknown> = {}) =>
    ((await (await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 }, ...extra }, cookie))).json()) as { id: string }).id;
  const admin = await as("boss@willey.test");
  const get = async <T>(path: string, cookie = admin) => {
    const res = await app.request(path, { headers: { cookie } });
    return { status: res.status, body: res.status === 200 ? ((await res.json()) as T) : undefined };
  };
  return { app, sent, as, newGame, admin, get };
}

describe("The admin pages", () => {
  it("answer only the people in ADMIN_EMAILS; to anyone else they don't exist", async () => {
    const { app, as, get } = await setup();
    const someone = await as("someone@willey.test");

    expect((await get("/api/admin/people", someone)).status).toBe(404);
    expect((await get("/api/admin/games", someone)).status).toBe(404);
    expect((await app.request("/api/admin/people")).status).toBe(404);
    expect((await get("/api/admin/people")).status).toBe(200);
  });

  it("are off altogether when no admin is set", async () => {
    const { sent, mailer } = capturingMailer();
    const { app } = createServer({ dbPath: ":memory:", mailer });
    const cookie = await signIn(app, sent, "boss@willey.test");
    expect((await app.request("/api/admin/people", { headers: { cookie } })).status).toBe(404);
  });

  it("tell the session whether the person is an admin", async () => {
    const { as, get } = await setup();
    expect((await get<{ admin: boolean }>("/api/session")).body!.admin).toBe(true);
    expect((await get<{ admin: boolean }>("/api/session", await as("someone@willey.test"))).body!.admin).toBe(false);
  });

  it("list the people who signed in: when, whether they're OK with a feedback email, their Games, demos and Organizations", async () => {
    const { app, as, newGame, get } = await setup();
    const ann = await as("ann@willey.test");
    await newGame(ann, { name: "Party" });
    await newGame(ann, { name: "Demo game", demo: true });
    await app.request("/api/orgs", post({ name: "Lodge 22" }, ann));

    const people = (await get<Person[]>("/api/admin/people")).body!;
    const annRow = people.find((p) => p.email === "ann@willey.test")!;
    expect(annRow).toMatchObject({ games: 1, demoGames: 1, organizations: ["Lodge 22"], feedbackOk: false });
    expect(annRow.firstSeen).toBeTruthy();
    expect(annRow.lastSignIn).toBeTruthy();
  });

  it("list every Game, demo or not, with its Host", async () => {
    const { as, newGame, get } = await setup();
    const ann = await as("ann@willey.test");
    const party = await newGame(ann, { name: "Party" });
    const demo = await newGame(ann, { name: "Demo game", demo: true });

    const all = (await get<AdminGame[]>("/api/admin/games")).body!;
    expect(all.find((g) => g.id === party)).toMatchObject({ name: "Party", demo: false, host: "ann@willey.test", phase: "setup", players: 0 });
    expect(all.find((g) => g.id === demo)).toMatchObject({ demo: true });
  });

  it("delete a Game and everything in it", async () => {
    const { app, as, newGame, admin, get } = await setup();
    const ann = await as("ann@willey.test");
    const id = await newGame(ann);
    await app.request(`/api/games/${id}/commands`, post({ type: "AddPlayer", playerId: "p1", name: "Pat" }, ann));
    await app.request(`/api/games/${id}/posts`, post({ text: "Hi", name: "Ann" }, ann));

    expect((await app.request(`/api/admin/games/${id}`, del(admin))).status).toBe(204);

    expect((await app.request(`/api/games/${id}`)).status).toBe(404);
    expect((await get<AdminGame[]>("/api/admin/games")).body!.map((g) => g.id)).not.toContain(id);
    expect((await (await app.request("/api/games", { headers: { cookie: ann } })).json()) as unknown[]).toEqual([]);
  });

  it("won't let anyone else delete a Game", async () => {
    const { app, as, newGame } = await setup();
    const ann = await as("ann@willey.test");
    const id = await newGame(ann);
    expect((await app.request(`/api/admin/games/${id}`, del(ann))).status).toBe(404);
    expect((await app.request(`/api/games/${id}`)).status).toBe(200);
  });

  it("clear out the smoke test's @example.com people, their Games and Organizations, and nobody else's", async () => {
    const { app, as, newGame, admin, get } = await setup();
    const tester = await as("guest-abc@example.com");
    const testGame = await newGame(tester);
    await app.request("/api/orgs", post({ name: "Lodge test" }, tester));
    const ann = await as("ann@willey.test");
    const real = await newGame(ann);

    const res = await app.request("/api/admin/test-data/delete", post({}, admin));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ people: 1, games: 1, organizations: 1 });

    expect((await app.request(`/api/games/${testGame}`)).status).toBe(404);
    expect((await app.request(`/api/games/${real}`)).status).toBe(200);
    const emails = (await get<Person[]>("/api/admin/people")).body!.map((p) => p.email);
    expect(emails).not.toContain("guest-abc@example.com");
    expect(emails).toContain("ann@willey.test");
    // Their session is gone with them.
    expect((await app.request("/api/session", { headers: { cookie: tester } })).status).toBe(401);
  });
});

describe("Feedback emails", () => {
  it("are OK only for someone who ticked the box when asking for a sign-in link", async () => {
    const { app, sent, get } = await setup();
    await app.request("/api/auth/link", post({ email: "ann@willey.test", feedbackOk: true }));
    await app.request("/api/auth/verify", post({ token: tokenFor(sent, "ann@willey.test") }));
    await app.request("/api/auth/link", post({ email: "bob@willey.test" }));
    await app.request("/api/auth/verify", post({ token: tokenFor(sent, "bob@willey.test") }));

    const people = (await get<Person[]>("/api/admin/people")).body!;
    expect(people.find((p) => p.email === "ann@willey.test")!.feedbackOk).toBe(true);
    expect(people.find((p) => p.email === "bob@willey.test")!.feedbackOk).toBe(false);
  });

  it("stay OK on a later sign-in without the box ticked, and can be turned off or on from the app", async () => {
    const { app, sent, as, get } = await setup();
    await app.request("/api/auth/link", post({ email: "ann@willey.test", feedbackOk: true }));
    await app.request("/api/auth/verify", post({ token: tokenFor(sent, "ann@willey.test") }));
    const ann = await as("ann@willey.test"); // again, box not ticked
    expect((await get<{ feedbackOk: boolean }>("/api/session", ann)).body!.feedbackOk).toBe(true);

    expect((await app.request("/api/me/feedback", post({ ok: false }, ann))).status).toBe(204);
    expect((await get<{ feedbackOk: boolean }>("/api/session", ann)).body!.feedbackOk).toBe(false);
    await app.request("/api/me/feedback", post({ ok: true }, ann));
    expect((await get<Person[]>("/api/admin/people")).body!.find((p) => p.email === "ann@willey.test")!.feedbackOk).toBe(true);
  });

  it("can't be changed without signing in", async () => {
    const { app } = await setup();
    expect((await app.request("/api/me/feedback", post({ ok: true }))).status).toBe(401);
  });
});
