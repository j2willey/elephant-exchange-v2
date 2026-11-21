import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

function setup() {
  let now = new Date("2026-12-13T18:00:00Z");
  const { sent, mailer } = capturingMailer();
  const server = createServer({ dbPath: ":memory:", mailer, now: () => now, limits: { perDay: 2 } });
  const advance = (minutes: number) => (now = new Date(now.getTime() + minutes * 60_000));
  return { ...server, sent, advance };
}

describe("Sweeping out old sign-in records", () => {
  it("keeps sign-in links (and the IP addresses on them) for a day, then deletes them", async () => {
    const { app, sweep, advance } = setup();
    await app.request("/api/auth/link", post({ email: "ann@example.com" }));
    await app.request("/api/auth/link", post({ email: "bob@example.com" }));

    advance(23 * 60);
    expect(sweep()).toMatchObject({ links: 0 });
    // Still counted towards the day's limit, so sweeping can't be used to get around it.
    expect((await app.request("/api/auth/link", post({ email: "cat@example.com" }))).status).toBe(429);

    advance(60);
    expect(sweep()).toMatchObject({ links: 2 });
    expect((await app.request("/api/auth/link", post({ email: "cat@example.com" }))).status).toBe(202);
  });

  it("deletes sessions once they expire after 30 days, and leaves live ones signed in", async () => {
    const { app, sent, sweep, advance } = setup();
    const ann = await signIn(app, sent, "ann@example.com");
    advance(10 * 24 * 60);
    const bob = await signIn(app, sent, "bob@example.com");

    advance(21 * 24 * 60); // Ann's session is 31 days old, Bob's 21
    expect(sweep()).toMatchObject({ sessions: 1 });

    expect((await app.request("/api/session", { headers: { cookie: ann } })).status).toBe(401);
    expect((await app.request("/api/session", { headers: { cookie: bob } })).status).toBe(200);
  });
});

describe("Letting go of Games nobody's using", () => {
  it("forgets a Game left alone for 6 hours, and rebuilds it from the database, unchanged, when it's asked for again", async () => {
    const { app, sent, sweep, advance } = setup();
    const host = await signIn(app, sent, "host@example.com");
    const { id } = (await (await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 } }, host))).json()) as { id: string };
    const command = (cmd: unknown) => app.request(`/api/games/${id}/commands`, post(cmd, host));
    await command({ type: "AddPlayer", playerId: "ann", name: "Ann" });
    await app.request(`/api/games/${id}/posts`, post({ text: "Hello", name: "Host" }, host));
    const read = async () => ({
      game: (await (await app.request(`/api/games/${id}`, { headers: { cookie: host } })).json()) as Record<string, unknown>,
      posts: await (await app.request(`/api/games/${id}/posts`)).json(),
    });
    const before = await read();

    advance(5 * 60);
    expect(sweep()).toMatchObject({ gamesForgotten: 0 }); // still in use, as far as anyone knows
    advance(61);
    expect(sweep()).toMatchObject({ gamesForgotten: 1 });

    // The same Game and Feed (only the server's clock reading has moved on).
    expect(await read()).toEqual({ ...before, game: { ...before.game, clock: expect.anything() } });
    expect(sweep()).toMatchObject({ gamesForgotten: 0 }); // just asked for again
  });
});
