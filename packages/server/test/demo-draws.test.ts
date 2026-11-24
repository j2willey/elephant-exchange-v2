import { describe, expect, it } from "vitest";
import { createServer, scriptedDraws } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

type Game = { active: string[]; onDeck: string[] };

/**
 * A guided demo names who the Draw picks next in an `x-demo-draws` header (ADR 0006), so its script plays the same
 * every time. The server's own Draw here always takes the last candidate, so a test can tell the two apart.
 */
async function setup({ demo = true } = {}) {
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer, draw: (c) => c.at(-1)! });
  const host = await signIn(app, sent, "host@example.com");
  const res = await app.request("/api/games", post({ name: "Demo game", demo, settings: { activeSlots: 1, maxSteals: 3 } }, host));
  const { id } = (await res.json()) as { id: string };
  const command = (cmd: unknown, cookie: string | undefined, headers: Record<string, string> = {}) => {
    const req = post(cmd, cookie);
    return app.request(`/api/games/${id}/commands`, { ...req, headers: { ...req.headers, ...headers } });
  };
  for (const p of ["ann", "ben", "cat", "dev"]) await command({ type: "AddPlayer", playerId: p, name: p }, host);
  return { app, sent, id, host, command };
}

describe("A demo Game's scripted Draws", () => {
  it("draw who the Host lists, in order", async () => {
    const { command, host } = await setup();
    const res = await command({ type: "StartGame" }, host, { "x-demo-draws": "ben,ann,cat" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ active: ["ben"], onDeck: ["ann"] } satisfies Game);

    // The next command lists what's left; the Turn ending draws the next of them.
    const opened = await command({ type: "OpenGift", playerId: "ben", giftId: "g1", name: "Socks" }, host, { "x-demo-draws": "cat" });
    expect(await opened.json()).toMatchObject({ active: ["ann"], onDeck: ["cat"] } satisfies Game);
  });

  it("are refused in a real Game, and for anyone but its Hosts", async () => {
    const real = await setup({ demo: false });
    expect((await real.command({ type: "StartGame" }, real.host, { "x-demo-draws": "ann" })).status).toBe(403);

    const { app, sent, command } = await setup();
    const stranger = await signIn(app, sent, "stranger@example.com");
    expect((await command({ type: "StartGame" }, stranger, { "x-demo-draws": "ann" })).status).toBe(403);
    expect((await command({ type: "StartGame" }, undefined, { "x-demo-draws": "ann" })).status).toBe(401);
  });

  it("fall back to the usual Draw for a Player who can't be drawn", async () => {
    const { command, host } = await setup();
    const res = await command({ type: "StartGame" }, host, { "x-demo-draws": "nobody,ann" });
    // Ann first, as listed; then nobody listed is left, so the server's Draw (the last candidate) picks.
    expect(await res.json()).toMatchObject({ active: ["ann"], onDeck: ["dev"] } satisfies Game);
  });

  it("leave a command without the header to the usual Draw", async () => {
    const { command, host } = await setup();
    expect(await (await command({ type: "StartGame" }, host)).json()).toMatchObject({ active: ["dev"], onDeck: ["cat"] } satisfies Game);
  });
});

describe("scriptedDraws", () => {
  it("takes the first listed candidate and uses it up, skipping any who can't be drawn", () => {
    const draw = scriptedDraws(["dev", "ann", "ben"], () => "random");
    expect(draw(["ann", "ben"])).toBe("ann");
    expect(draw(["ben", "cat"])).toBe("ben");
    expect(draw(["cat"])).toBe("random");
  });
});
