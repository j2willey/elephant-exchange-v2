import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("Games over HTTP", () => {
  it("creates a Game that can then be fetched, still in setup", async () => {
    const { app } = createServer({ dbPath: ":memory:" });

    const created = await app.request("/api/games", json({ settings: { activeSlots: 1, maxSteals: 3 } }));
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
    const { app } = createServer({ dbPath: ":memory:" });
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const res = await app.request("/api/games", json({ settings: { activeSlots: 1, maxSteals: 3 } }));
      ids.add(((await res.json()) as { id: string }).id);
    }

    expect(ids.size).toBe(20);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{16,}$/); // URL-safe, at least ~96 bits
  });

  it("answers 404 for a Game that doesn't exist", async () => {
    const { app } = createServer({ dbPath: ":memory:" });
    expect((await app.request("/api/games/nope")).status).toBe(404);
  });
});
