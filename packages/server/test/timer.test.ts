import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, scriptedDraw, signIn } from "./support.js";

type Shown = { clock: { now: number; turnSeconds: number; startedAt: Record<string, number> } };

async function setup(turnSeconds?: number, activeSlots = 1) {
  let ms = Date.UTC(2026, 11, 13, 19, 0, 0);
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer, now: () => new Date(ms), draw: scriptedDraw(["ann", "bob", "cat"]) });
  const host = await signIn(app, sent, "host@example.com");
  const settings = { activeSlots, maxSteals: 3 };
  const res = await app.request("/api/games", post(turnSeconds === undefined ? { settings } : { settings, turnSeconds }, host));
  const { id } = (await res.json()) as { id: string };
  const command = (cmd: unknown) => app.request(`/api/games/${id}/commands`, post(cmd, host));
  for (const p of ["ann", "bob", "cat"]) await command({ type: "AddPlayer", playerId: p, name: p });
  const start = ms;
  await command({ type: "StartGame" });
  const shown = async () => ((await (await app.request(`/api/games/${id}`)).json()) as Shown).clock;
  return { app, sent, host, id, command, shown, start, tick: (s: number) => (ms += s * 1000), at: () => ms };
}

describe("Turn clocks", () => {
  it("start when a Player is called up, and say the server's time so screens can allow for their own clock", async () => {
    const { shown, start, tick, at } = await setup();
    tick(25);

    expect(await shown()).toEqual({ now: at(), turnSeconds: 60, startedAt: { ann: start } });
  });

  it("start again for each Player called up, a Victim included, and stop for anyone no longer up", async () => {
    const { command, shown, tick, at } = await setup();
    tick(10);
    await command({ type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });
    expect((await shown()).startedAt).toEqual({ bob: at() });

    tick(10);
    await command({ type: "Steal", playerId: "bob", giftId: "g1" });

    expect((await shown()).startedAt).toEqual({ ann: at() });
  });

  it("keep running for a Player still up while another's Turn ends", async () => {
    const { command, shown, start, tick, at } = await setup(undefined, 2);
    tick(10);

    await command({ type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });

    expect((await shown()).startedAt).toEqual({ bob: start, cat: at() });
  });

  it("can be reset by the Host or a Co-host only, and only for a Player who's up", async () => {
    const { app, sent, host, id, shown, tick, at } = await setup();
    tick(30);
    const other = await signIn(app, sent, "eve@example.com");

    expect((await app.request(`/api/games/${id}/timer`, post({ playerId: "ann" }))).status).toBe(401);
    expect((await app.request(`/api/games/${id}/timer`, post({ playerId: "ann" }, other))).status).toBe(403);
    expect((await app.request(`/api/games/${id}/timer`, post({ playerId: "bob" }, host))).status).toBe(409);
    expect((await app.request(`/api/games/${id}/timer`, post({ playerId: "ann" }, host))).status).toBe(200);

    expect((await shown()).startedAt).toEqual({ ann: at() });
  });

  it("take their length from the Game: from none (0) to ten minutes", async () => {
    expect((await (await setup(0)).shown()).turnSeconds).toBe(0);
    expect((await (await setup(90)).shown()).turnSeconds).toBe(90);
  });
});
