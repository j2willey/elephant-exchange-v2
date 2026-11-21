import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

function setup() {
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer });
  return { app, sent };
}

describe("Games over HTTP", () => {
  it("creates a Game that can then be fetched, still in setup", async () => {
    const { app, sent } = setup();
    const cookie = await signIn(app, sent, "host@example.com");

    const created = await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 } }, cookie));
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const fetched = await app.request(`/api/games/${id}`);
    expect(fetched.status).toBe(200);
    expect(await fetched.json()).toMatchObject({
      id,
      phase: "setup",
      settings: { activeSlots: 1, maxSteals: 3 },
      players: [],
    });
  });

  it("gives each Game a hard-to-guess id", async () => {
    const { app, sent } = setup();
    const cookie = await signIn(app, sent, "host@example.com");
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const res = await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 } }, cookie));
      ids.add(((await res.json()) as { id: string }).id);
    }

    expect(ids.size).toBe(20);
    for (const id of ids) expect(id).toMatch(/^a\.[A-Za-z0-9_-]{16,}$/); // its server tag, then URL-safe and at least ~96 bits
  });

  it("lists Games only to someone signed in", async () => {
    const { app } = setup();
    expect((await app.request("/api/games")).status).toBe(401);
  });

  it("answers 404 for a Game that doesn't exist", async () => {
    const { app } = setup();
    expect((await app.request("/api/games/nope")).status).toBe(404);
  });

  it("rejects malformed Game settings with 400", async () => {
    const { app, sent } = setup();
    const cookie = await signIn(app, sent, "host@example.com");
    expect((await app.request("/api/games", post({ settings: { activeSlots: -1, maxSteals: 3 } }, cookie))).status).toBe(400);
    expect((await app.request("/api/games", post({}, cookie))).status).toBe(400);
  });

  it("tells each viewer whether they run the Game", async () => {
    const { app, sent } = setup();
    const host = await signIn(app, sent, "host@example.com");
    const { id } = (await (await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 } }, host))).json()) as { id: string };
    await app.request(`/api/games/${id}/cohosts`, post({ email: "bob@example.com" }, host));
    const bob = await signIn(app, sent, "bob@example.com");
    const stranger = await signIn(app, sent, "cat@example.com");
    const roleOf = async (cookie?: string) =>
      ((await (await app.request(`/api/games/${id}`, cookie ? { headers: { cookie } } : {})).json()) as { role: unknown }).role;

    expect(await roleOf(host)).toBe("host");
    expect(await roleOf(bob)).toBe("cohost");
    expect(await roleOf(stranger)).toBeNull();
    expect(await roleOf()).toBeNull();
  });
});
