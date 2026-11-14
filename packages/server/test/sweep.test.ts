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
