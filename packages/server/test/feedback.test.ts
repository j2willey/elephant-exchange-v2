import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

type Mine = { asked: boolean; as: "host" | "guest"; given: { rating: number | null; thumbs: string | null; comment: string | null } | null };
type Summary = {
  averageRating: number | null;
  ratings: number;
  again: Record<string, number>;
  thumbs: Record<string, number>;
  suggestions: number;
  items: { kind: string; game: string | null; from: string | null; rating: number | null; thumbs: string | null; comment: string | null }[];
};

async function setup() {
  let ms = Date.UTC(2026, 11, 13, 19, 0, 0);
  const { sent, asked, mailer } = capturingMailer();
  const server = createServer({ dbPath: ":memory:", mailer, baseUrl: "https://elephantexchange.app", now: () => new Date(ms), adminEmails: ["boss@willey.test"], draw: (w) => w[0]! });
  const { app } = server;
  const as = (email: string) => signIn(app, sent, email);
  const hours = (n: number) => (ms += n * 60 * 60_000);
  const send = (id: string, cookie: string, cmd: unknown) => app.request(`/api/games/${id}/commands`, post(cmd, cookie));
  const mine = async (id: string, cookie: string) => (await (await app.request(`/api/games/${id}/feedback`, { headers: { cookie } })).json()) as Mine;
  const answer = (id: string, cookie: string, body: unknown) => app.request(`/api/games/${id}/feedback`, post(body, cookie));
  const admin = async () => (await (await app.request("/api/admin/feedback", { headers: { cookie: await as("boss@willey.test") } })).json()) as Summary;

  /** Ann's party, played and ended; Gus is a guest who signed up as a Player on his phone. */
  async function party({ feedbackOk = true, end = true } = {}) {
    const ann = await as("ann@willey.test");
    if (feedbackOk) await app.request("/api/me/feedback", post({ ok: true }, ann));
    const id = ((await (await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 }, name: "Office party", rosterMode: "self" }, ann))).json()) as { id: string }).id;
    const gus = await as("gus@willey.test");
    await app.request(`/api/games/${id}/join`, post({ name: "Gus" }, gus));
    for (const p of ["a", "b", "c"]) await send(id, ann, { type: "AddPlayer", playerId: p, name: p.toUpperCase() });
    await send(id, ann, { type: "StartGame" });
    if (end) await send(id, ann, { type: "EndGame" });
    return { id, ann, gus };
  }
  return { app, server, as, hours, send, mine, answer, admin, asked, party };
}

describe("Asking how a Game went", () => {
  it("asks the Host for stars once the Game is over, not before, and lets them change their answer", async () => {
    const { party, mine, answer, send, admin } = await setup();
    const { id, ann } = await party({ end: false });
    expect(await mine(id, ann)).toMatchObject({ asked: false, as: "host" });
    expect((await answer(id, ann, { rating: 5 })).status).toBe(409);

    await send(id, ann, { type: "EndGame" });
    expect(await mine(id, ann)).toMatchObject({ asked: true, given: null });
    expect((await answer(id, ann, { thumbs: "up" })).status).toBe(400); // a Host gives stars
    expect((await answer(id, ann, { rating: 4, again: "yes", comment: "Loved the TV view" })).status).toBe(204);
    expect((await answer(id, ann, { rating: 5, again: "yes" })).status).toBe(204);

    expect((await mine(id, ann)).given).toMatchObject({ rating: 5, comment: null });
    expect(await admin()).toMatchObject({ averageRating: 5, ratings: 1, again: { yes: 1, maybe: 0, no: 0 } });
  });

  it("asks a guest for a thumbs up or down once it's over, but not while the vote is under way", async () => {
    const { app, party, mine, answer, admin } = await setup();
    const { id, ann, gus } = await party();
    await app.request(`/api/games/${id}/vote/status`, post({ status: "open" }, ann));
    expect(await mine(id, gus)).toMatchObject({ asked: false, as: "guest" });

    await app.request(`/api/games/${id}/vote/status`, post({ status: "closed" }, ann));
    expect((await answer(id, gus, { rating: 5 })).status).toBe(400); // a guest gives thumbs
    expect((await answer(id, gus, { thumbs: "up", comment: "So fun" })).status).toBe(204);

    const summary = await admin();
    expect(summary.thumbs).toEqual({ up: 1, down: 0 });
    expect(summary.items[0]).toMatchObject({ kind: "guest", game: "Office party", from: "gus@willey.test", thumbs: "up", comment: "So fun" });
  });

  it("keeps what was said after the Game is deleted", async () => {
    const { app, party, answer, admin } = await setup();
    const { id, ann } = await party();
    await answer(id, ann, { rating: 3 });
    await app.request(`/api/games/${id}`, { method: "DELETE", headers: { cookie: ann } });

    expect((await admin()).items[0]).toMatchObject({ kind: "host", game: "Office party", rating: 3 });
  });

  it("takes suggestions from anyone signed in", async () => {
    const { app, as, admin } = await setup();
    expect((await app.request("/api/feedback/suggestions", post({ comment: "A dark mode, please" }, await as("ann@willey.test")))).status).toBe(204);
    expect((await app.request("/api/feedback/suggestions", post({ comment: "   " }, await as("ann@willey.test")))).status).toBe(400);
    expect((await app.request("/api/feedback/suggestions", post({ comment: "Hi" }))).status).toBe(401);

    expect(await admin()).toMatchObject({ suggestions: 1, items: [{ kind: "suggestion", comment: "A dark mode, please", from: "ann@willey.test" }] });
  });

  it("is for the admin to read, and nobody else", async () => {
    const { app, as } = await setup();
    expect((await app.request("/api/admin/feedback", { headers: { cookie: await as("ann@willey.test") } })).status).toBe(404);
  });
});

describe("The follow-up email", () => {
  it("goes a day after the Game ends, once, to a Host who said it's OK and hasn't answered", async () => {
    const { server, party, hours, asked } = await setup();
    const { id } = await party();

    expect(await server.followUps()).toBe(0); // too soon
    hours(25);
    expect(await server.followUps()).toBe(1);
    expect(asked).toEqual([{ email: "ann@willey.test", gameName: "Office party", url: `https://elephantexchange.app/games/${id}` }]);
    hours(1);
    expect(await server.followUps()).toBe(0); // never twice
  });

  it("isn't sent to a Host who didn't say it's OK, or who has already answered, or after a week", async () => {
    const quiet = await setup();
    await quiet.party({ feedbackOk: false });
    quiet.hours(25);
    expect(await quiet.server.followUps()).toBe(0);

    const answered = await setup();
    const { id, ann } = await answered.party();
    await answered.answer(id, ann, { rating: 4 });
    answered.hours(25);
    expect(await answered.server.followUps()).toBe(0);

    const late = await setup();
    await late.party();
    late.hours(8 * 24);
    expect(await late.server.followUps()).toBe(0);
  });

  it("leaves sign-in emails the bigger share of the day's allowance", async () => {
    const { app, server, party, hours } = await setup();
    await party();
    hours(25);
    // A busy day: half the cap of 100 already went on sign-in links.
    for (let i = 0; i < 50; i++) await app.request("/api/auth/link", post({ email: `guest${i}@willey.test` }));
    expect(await server.followUps()).toBe(0);
  });
});
