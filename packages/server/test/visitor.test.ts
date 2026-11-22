import { describe, expect, it } from "vitest";
import { createServer, DEMO_VISITORS_PER_HOUR } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

/** A server with an admin and a movable clock; `visit` asks for a demo visitor's session and returns its cookie. */
function setup(options: { overload?: { maxScreens?: number } } = {}) {
  let now = new Date("2026-12-01T18:00:00Z");
  const { sent, mailer } = capturingMailer();
  const server = createServer({ dbPath: ":memory:", mailer, now: () => now, adminEmails: ["jim@example.org"], ...options });
  const { app } = server;
  const visit = async (cookie?: string) => {
    const res = await app.request("/api/demo/visitor", post({}, cookie));
    return { res, cookie: res.headers.get("set-cookie")?.match(/^session=[^;]+/)?.[0] };
  };
  const createGame = (cookie: string, demo: boolean) => app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 }, demo }, cookie));
  const advance = (days: number) => (now = new Date(now.getTime() + days * 24 * 60 * 60_000));
  return { ...server, sent, visit, createGame, advance };
}

describe("Trying the demo without signing in", () => {
  it("gives the browser a stand-in session at once, with no email, that can run demo Games", async () => {
    const { app, sent, visit, createGame } = setup();

    const { res, cookie } = await visit();

    expect(res.status).toBe(200);
    expect(sent).toEqual([]); // nothing emailed
    const session = (await (await app.request("/api/session", { headers: { cookie: cookie! } })).json()) as { email: string; visitor: boolean };
    expect(session).toMatchObject({ visitor: true, email: expect.stringMatching(/@visitors\.invalid$/) });
    expect((await createGame(cookie!, true)).status).toBe(201);
  });

  it("can't host a real Game or create an Organization until they sign in with their email", async () => {
    const { app, visit, createGame } = setup();
    const { cookie } = await visit();

    const real = await createGame(cookie!, false);
    expect(real.status).toBe(403);
    expect(await real.json()).toEqual({ error: "signInToHost" });
    expect((await app.request("/api/orgs", post({ name: "Lodge 22" }, cookie))).status).toBe(401);
  });

  it("can't join, post, react or vote in a real Game, even with its link", async () => {
    const { app, sent, visit } = setup();
    const host = await signIn(app, sent, "host@example.com");
    const made = await app.request("/api/games", post({ rosterMode: "self", settings: { activeSlots: 1, maxSteals: 3 } }, host));
    const { id } = (await made.json()) as { id: string };
    const command = (cmd: unknown) => app.request(`/api/games/${id}/commands`, post(cmd, host));
    await command({ type: "AddPlayer", playerId: "ann", name: "Ann" });
    await app.request(`/api/games/${id}/posts`, post({ text: "Welcome!", name: "Host" }, host));
    const [{ id: postId }] = (await (await app.request(`/api/games/${id}/posts`)).json()) as [{ id: string }];
    const { cookie } = await visit();

    const tries = [
      app.request(`/api/games/${id}/join`, post({ name: "Vic" }, cookie)),
      app.request(`/api/games/${id}/posts`, post({ text: "Hi", name: "Vic" }, cookie)),
      app.request(`/api/games/${id}/posts/${postId}/reactions`, post({ emoji: "😂", on: true }, cookie)),
      app.request(`/api/games/${id}/vote`, post({ giftId: "g1" }, cookie)),
      app.request(`/api/games/${id}/me/name`, post({ name: "Vic" }, cookie)),
    ];
    for (const r of await Promise.all(tries)) {
      expect(r.status).toBe(401);
    }
    const seen = (await (await app.request(`/api/games/${id}`, { headers: { cookie: cookie! } })).json()) as { role: unknown; me: unknown };
    expect(seen).toMatchObject({ role: null, me: null });
  });

  it("still plays in demo Games", async () => {
    const { app, visit, createGame } = setup();
    const { cookie } = await visit();
    const { id } = (await (await createGame(cookie!, true)).json()) as { id: string };

    expect((await app.request(`/api/games/${id}/posts`, post({ text: "Hi", name: "Vic" }, cookie))).status).toBe(201);
  });

  it("leaves someone already signed in as they are", async () => {
    const { app, sent, visit } = setup();
    const ann = await signIn(app, sent, "ann@example.com");

    const { res, cookie } = await visit(ann);

    expect(cookie).toBeUndefined();
    expect(await res.json()).toEqual({ email: "ann@example.com", visitor: false });
  });

  it("isn't counted among the people who signed in, but as a demo try on the Stats page", async () => {
    const { app, sent, visit } = setup();
    await visit();
    await visit();
    const jim = await signIn(app, sent, "jim@example.org");

    const people = (await (await app.request("/api/admin/people", { headers: { cookie: jim } })).json()) as { email: string }[];
    expect(people.map((p) => p.email)).toEqual(["jim@example.org"]);
    const stats = (await (await app.request("/api/admin/stats", { headers: { cookie: jim } })).json()) as { insights: { demoVisitors: { count: number }[] } };
    expect(stats.insights.demoVisitors).toEqual([{ day: "2026-12-01", count: 2 }]);
  });

  it(`starts at most ${DEMO_VISITORS_PER_HOUR} from one address in an hour, and none while the server is too busy`, async () => {
    const { visit } = setup();
    for (let i = 0; i < DEMO_VISITORS_PER_HOUR; i++) expect((await visit()).res.status).toBe(200);
    expect((await visit()).res.status).toBe(429);

    const busy = setup({ overload: { maxScreens: 0 } });
    expect((await busy.visit()).res.status).toBe(503);
  });

  it("is let go after a week, with its demo Games", async () => {
    const { app, visit, createGame, advance, sweep } = setup();
    const { cookie } = await visit();
    const { id } = (await (await createGame(cookie!, true)).json()) as { id: string };

    advance(6);
    expect(sweep()).toMatchObject({ visitors: 0 });
    advance(1);
    expect(sweep()).toMatchObject({ visitors: 1 });

    expect((await app.request(`/api/games/${id}`)).status).toBe(404);
    expect((await app.request("/api/session", { headers: { cookie: cookie! } })).status).toBe(401);
  });
});
