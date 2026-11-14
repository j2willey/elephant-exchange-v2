import { describe, expect, it } from "vitest";
import type { DrawFn } from "@elephant/rules";
import { createServer } from "../src/server.js";

const post = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Draws Players in a fixed order, so tests know who is called up. */
function scriptedDraw(order: string[]): DrawFn {
  const queue = [...order];
  return (candidates) => {
    const next = queue.shift();
    if (!next || !candidates.includes(next)) throw new Error(`script can't draw ${next} from ${candidates.join(",")}`);
    return next;
  };
}

async function newGame(app: ReturnType<typeof createServer>["app"], settings = { activeSlots: 1, maxSteals: 3 }) {
  const res = await app.request("/api/games", post({ settings }));
  return ((await res.json()) as { id: string }).id;
}

describe("Commands over HTTP", () => {
  it("applies a command and answers with the Game as it now stands", async () => {
    const { app } = createServer({ dbPath: ":memory:", draw: scriptedDraw(["ann", "bob"]) });
    const id = await newGame(app);
    const send = (command: unknown) => app.request(`/api/games/${id}/commands`, post(command));

    await send({ type: "AddPlayer", playerId: "ann", name: "Ann" });
    await send({ type: "AddPlayer", playerId: "bob", name: "Bob" });
    await send({ type: "StartGame" });
    const res = await send({ type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      phase: "playing",
      players: [
        { id: "ann", name: "Ann" },
        { id: "bob", name: "Bob" },
      ],
      active: ["bob"],
      onDeck: [],
      gifts: [{ id: "g1", name: "Socks", holderId: "ann", steals: 0, frozen: false }],
    });
    // The fetched Game agrees with what the command answered.
    expect(await (await app.request(`/api/games/${id}`)).json()).toMatchObject({ active: ["bob"] });
  });

  it("refuses a move the rules don't allow with 409 and the rule's code, changing nothing", async () => {
    const { app } = createServer({ dbPath: ":memory:", draw: scriptedDraw(["ann"]) });
    const id = await newGame(app);
    const send = (command: unknown) => app.request(`/api/games/${id}/commands`, post(command));
    await send({ type: "AddPlayer", playerId: "ann", name: "Ann" });
    await send({ type: "AddPlayer", playerId: "bob", name: "Bob" });
    await send({ type: "StartGame" });

    const res = await send({ type: "OpenGift", playerId: "bob", giftId: "g1", name: "Socks" });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "NotActive" });
    expect(await (await app.request(`/api/games/${id}`)).json()).toMatchObject({ gifts: [] });
  });

  it("rejects a malformed command with 400", async () => {
    const { app } = createServer({ dbPath: ":memory:" });
    const id = await newGame(app);
    const send = (command: unknown) => app.request(`/api/games/${id}/commands`, post(command));

    expect((await send({ type: "Explode" })).status).toBe(400);
    expect((await send({ type: "AddPlayer", playerId: "ann" })).status).toBe(400); // no name
    expect((await send({ type: "ChangeSettings", settings: { activeSlots: 0 } })).status).toBe(400);
  });

  it("rejects malformed Game settings with 400", async () => {
    const { app } = createServer({ dbPath: ":memory:" });
    expect((await app.request("/api/games", post({ settings: { activeSlots: -1, maxSteals: 3 } }))).status).toBe(400);
    expect((await app.request("/api/games", post({}))).status).toBe(400);
  });

  it("answers 404 for commands to a Game that doesn't exist", async () => {
    const { app } = createServer({ dbPath: ":memory:" });
    expect((await app.request("/api/games/nope/commands", post({ type: "StartGame" }))).status).toBe(404);
  });
});
