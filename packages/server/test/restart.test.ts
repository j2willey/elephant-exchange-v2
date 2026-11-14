import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DrawFn } from "@elephant/rules";
import { createServer } from "../src/server.js";

const post = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

function scriptedDraw(order: string[]): DrawFn {
  const queue = [...order];
  return (candidates) => {
    const next = queue.shift();
    if (!next || !candidates.includes(next)) throw new Error(`script can't draw ${next} from ${candidates.join(",")}`);
    return next;
  };
}

/** A restarted server must replay its log, never draw again: any Draw here fails the test. */
const noDraws: DrawFn = () => {
  throw new Error("replay must not draw");
};

describe("Surviving a restart", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "elephant-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("a new server on the same database shows every Game exactly as it was, and play carries on", async () => {
    const dbPath = join(dir, "games.db");
    const first = createServer({ dbPath, draw: scriptedDraw(["ann", "bob", "cat"]) });
    const created = await first.app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 } }));
    const { id } = (await created.json()) as { id: string };
    const send = (app: typeof first.app, command: unknown) => app.request(`/api/games/${id}/commands`, post(command));

    for (const [pid, name] of [["ann", "Ann"], ["bob", "Bob"], ["cat", "Cat"]]) {
      await send(first.app, { type: "AddPlayer", playerId: pid, name });
    }
    await send(first.app, { type: "StartGame" });
    await send(first.app, { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });
    await send(first.app, { type: "Steal", playerId: "bob", giftId: "g1" });
    await send(first.app, { type: "OpenGift", playerId: "ann", giftId: "g2", name: "Mug" });
    await send(first.app, { type: "Undo" });
    const before = await (await first.app.request(`/api/games/${id}`)).json();

    const second = createServer({ dbPath, draw: noDraws });
    expect(await (await second.app.request(`/api/games/${id}`)).json()).toEqual(before);

    // Ann still holds the floor after the Undo; she can open a different Gift on the restarted server.
    const res = await send(second.app, { type: "OpenGift", playerId: "ann", giftId: "g3", name: "Candle" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      gifts: [
        { id: "g1", holderId: "bob", steals: 1 },
        { id: "g3", holderId: "ann" },
      ],
    });
  });

  it("refused commands leave nothing in the log", async () => {
    const dbPath = join(dir, "games.db");
    const first = createServer({ dbPath, draw: scriptedDraw(["ann", "bob"]) });
    const { id } = (await (await first.app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 } }))).json()) as { id: string };
    const send = (command: unknown) => first.app.request(`/api/games/${id}/commands`, post(command));
    await send({ type: "AddPlayer", playerId: "ann", name: "Ann" });
    await send({ type: "AddPlayer", playerId: "bob", name: "Bob" });
    await send({ type: "StartGame" });
    expect((await send({ type: "OpenGift", playerId: "bob", giftId: "g1", name: "Socks" })).status).toBe(409);
    const before = await (await first.app.request(`/api/games/${id}`)).json();

    const second = createServer({ dbPath, draw: noDraws });
    expect(await (await second.app.request(`/api/games/${id}`)).json()).toEqual(before);
  });
});
