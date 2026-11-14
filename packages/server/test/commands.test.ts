import { describe, expect, it } from "vitest";
import type { DrawFn } from "@elephant/rules";
import { createServer } from "../src/server.js";
import { capturingMailer, hostGame, post, scriptedDraw } from "./support.js";

/** A Game with a signed-in Host, and a way to send it commands as that Host. */
async function setup(draw?: DrawFn) {
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer, ...(draw ? { draw } : {}) });
  const { id, cookie } = await hostGame(app, sent);
  const send = (command: unknown) => app.request(`/api/games/${id}/commands`, post(command, cookie));
  return { app, id, cookie, send };
}

describe("Commands over HTTP", () => {
  it("applies a command and answers with the Game as it now stands", async () => {
    const { app, id, send } = await setup(scriptedDraw(["ann", "bob"]));

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
    const { app, id, send } = await setup(scriptedDraw(["ann", "bob"]));
    await send({ type: "AddPlayer", playerId: "ann", name: "Ann" });
    await send({ type: "AddPlayer", playerId: "bob", name: "Bob" });
    await send({ type: "StartGame" });

    const res = await send({ type: "OpenGift", playerId: "bob", giftId: "g1", name: "Socks" });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "NotActive" });
    expect(await (await app.request(`/api/games/${id}`)).json()).toMatchObject({ gifts: [] });
  });

  it("rejects a malformed command with 400", async () => {
    const { send } = await setup();

    expect((await send({ type: "Explode" })).status).toBe(400);
    expect((await send({ type: "AddPlayer", playerId: "ann" })).status).toBe(400); // no name
    expect((await send({ type: "ChangeSettings", settings: { activeSlots: 0 } })).status).toBe(400);
  });

  it("answers 404 for commands to a Game that doesn't exist", async () => {
    const { app, cookie } = await setup();
    expect((await app.request("/api/games/nope/commands", post({ type: "StartGame" }, cookie))).status).toBe(404);
  });

  it("numbers every change, so a screen can tell which copy of the Game is newest", async () => {
    const { app, id, send } = await setup(scriptedDraw(["ann", "bob"]));
    const versionOf = async (res: Response | Promise<Response>) => ((await (await res).json()) as { version: number }).version;
    const v0 = await versionOf(app.request(`/api/games/${id}`));

    const v1 = await versionOf(send({ type: "AddPlayer", playerId: "ann", name: "Ann" }));
    const v2 = await versionOf(send({ type: "AddPlayer", playerId: "bob", name: "Bob" }));
    await send({ type: "Undo" }); // refused: changes nothing

    expect(v1).toBeGreaterThan(v0);
    expect(v2).toBeGreaterThan(v1);
    expect(await versionOf(app.request(`/api/games/${id}`))).toBe(v2);
  });

  it("shows how many leftover Gifts are still unopened during the Final Round", async () => {
    const { send } = await setup(scriptedDraw(["ann", "bob"]));
    await send({ type: "AddPlayer", playerId: "ann", name: "Ann" });
    await send({ type: "AddPlayer", playerId: "bob", name: "Bob" });
    await send({ type: "StartGame" });
    await send({ type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });
    await send({ type: "OpenGift", playerId: "bob", giftId: "g2", name: "Mug" });

    const started = await send({ type: "StartFinalRound", finalists: 2, leftoverGifts: 2 });
    expect(await started.json()).toMatchObject({ phase: "finalRound", leftoverGifts: 2, active: ["ann"], onDeck: ["bob"] });

    const opened = await send({ type: "OpenGift", playerId: "ann", giftId: "g3", name: "Candle" });
    expect(await opened.json()).toMatchObject({ leftoverGifts: 1 });
  });
});
