import { describe, expect, it } from "vitest";
import {
  activePlayers,
  decide,
  evolve,
  newGame,
  holderOf,
  isFrozen,
  onDeck,
  pickCount,
  turnCount,
  type Command,
  type DrawFn,
  type GameSettings,
  type GameState,
} from "../src/index.js";

/** A Draw that returns Players in a fixed order, so tests know who is drawn. */
function scriptedDraw(order: string[]): DrawFn {
  const queue = [...order];
  return (candidates) => {
    const next = queue.shift();
    if (next === undefined) throw new Error("scriptedDraw: script ran out");
    if (!candidates.includes(next)) {
      throw new Error(`scriptedDraw: ${next} is not drawable (${candidates.join(", ")})`);
    }
    return next;
  };
}

/** Wraps a Draw and records the candidates offered each time, so tests can check who was drawable. */
function recordingDraw(inner: DrawFn): DrawFn & { offered: string[][] } {
  const offered: string[][] = [];
  const fn = (candidates: string[]) => {
    offered.push([...candidates].sort());
    return inner(candidates);
  };
  return Object.assign(fn, { offered });
}

/** Runs Commands through decide/evolve, failing the test on any RuleError. */
function play(settings: GameSettings, commands: Command[], draw: DrawFn): GameState {
  let state = newGame(settings);
  for (const command of commands) {
    const result = decide(state, command, draw);
    if (!Array.isArray(result)) throw new Error(`RuleError: ${result.message}`);
    for (const event of result) state = evolve(state, event);
  }
  return state;
}

const addPlayers = (...ids: string[]): Command[] =>
  ids.map((id) => ({ type: "AddPlayer", playerId: id, name: id }));

describe("Starting a Game", () => {
  it("draws one active Player and one On Deck when there is one active slot", () => {
    const state = play(
      { activeSlots: 1, maxSteals: 3 },
      [...addPlayers("ann", "bob", "cat"), { type: "StartGame" }],
      scriptedDraw(["bob", "cat"]),
    );

    expect(activePlayers(state)).toEqual(["bob"]);
    expect(onDeck(state)).toEqual(["cat"]);
  });
});

describe("Opening a Gift", () => {
  it("ends the Turn: the On Deck Player becomes active and the next Player is drawn On Deck", () => {
    const state = play(
      { activeSlots: 1, maxSteals: 3 },
      [
        ...addPlayers("ann", "bob", "cat"),
        { type: "StartGame" },
        { type: "OpenGift", playerId: "bob", giftId: "g1", name: "Chia Pet" },
      ],
      scriptedDraw(["bob", "cat", "ann"]),
    );

    expect(turnCount(state)).toBe(1);
    expect(pickCount(state)).toBe(1);
    expect(activePlayers(state)).toEqual(["cat"]);
    expect(onDeck(state)).toEqual(["ann"]);
  });
});

describe("Stealing a Gift", () => {
  it("makes the previous holder a Victim who acts before anyone On Deck, adding a Pick but not a Turn", () => {
    const draw = scriptedDraw(["bob", "cat", "ann"]);
    const state = play(
      { activeSlots: 1, maxSteals: 3 },
      [
        ...addPlayers("ann", "bob", "cat", "dan"),
        { type: "StartGame" },
        { type: "OpenGift", playerId: "bob", giftId: "g1", name: "Chia Pet" },
        { type: "Steal", playerId: "cat", giftId: "g1" },
      ],
      draw,
    );

    expect(holderOf(state, "g1")).toBe("cat");
    expect(activePlayers(state)).toEqual(["bob"]);
    expect(onDeck(state)).toEqual(["ann"]);
    expect(turnCount(state)).toBe(1);
    expect(pickCount(state)).toBe(2);
  });

  it("never offers a Victim to the Draw, and the Turn ends when the Victim opens a Gift", () => {
    const draw = recordingDraw(scriptedDraw(["bob", "cat", "ann", "dan"]));
    const state = play(
      { activeSlots: 1, maxSteals: 3 },
      [
        ...addPlayers("ann", "bob", "cat", "dan"),
        { type: "StartGame" },
        { type: "OpenGift", playerId: "bob", giftId: "g1", name: "Chia Pet" },
        { type: "Steal", playerId: "cat", giftId: "g1" },
        { type: "OpenGift", playerId: "bob", giftId: "g2", name: "Lava Lamp" },
      ],
      draw,
    );

    expect(draw.offered.at(-1)).toEqual(["dan"]);
    expect(turnCount(state)).toBe(2);
    expect(pickCount(state)).toBe(3);
    expect(activePlayers(state)).toEqual(["ann"]);
    expect(onDeck(state)).toEqual(["dan"]);
  });
});

describe("No take-backs", () => {
  it("rejects a Victim stealing back the Gift just taken from them", () => {
    const draw = scriptedDraw(["bob", "cat", "ann"]);
    const state = play(
      { activeSlots: 1, maxSteals: 3 },
      [
        ...addPlayers("ann", "bob", "cat", "dan"),
        { type: "StartGame" },
        { type: "OpenGift", playerId: "bob", giftId: "g1", name: "Chia Pet" },
        { type: "Steal", playerId: "cat", giftId: "g1" },
      ],
      draw,
    );

    const result = decide(state, { type: "Steal", playerId: "bob", giftId: "g1" }, draw);

    expect(result).toMatchObject({ code: "NoTakeBacks" });
  });
});

describe("Steal limit", () => {
  it("Freezes a Gift on the Steal that reaches the limit, and rejects any further Steal of it", () => {
    const draw = scriptedDraw(["bob", "cat", "ann", "dan", "eve"]);
    const state = play(
      { activeSlots: 1, maxSteals: 2 },
      [
        ...addPlayers("ann", "bob", "cat", "dan", "eve"),
        { type: "StartGame" },
        { type: "OpenGift", playerId: "bob", giftId: "g1", name: "Chia Pet" },
        { type: "Steal", playerId: "cat", giftId: "g1" }, // 1st Steal
        { type: "OpenGift", playerId: "bob", giftId: "g2", name: "Lava Lamp" },
        { type: "Steal", playerId: "ann", giftId: "g1" }, // 2nd Steal: limit reached
        { type: "OpenGift", playerId: "cat", giftId: "g3", name: "Fondue Set" },
      ],
      draw,
    );

    expect(isFrozen(state, "g1")).toBe(true);
    expect(activePlayers(state)).toEqual(["dan"]);
    expect(decide(state, { type: "Steal", playerId: "dan", giftId: "g1" }, draw)).toMatchObject({
      code: "GiftFrozen",
    });
  });
});

describe("Changing settings mid-Game", () => {
  it("lowering the steal limit Freezes Gifts already at the new limit", () => {
    const draw = scriptedDraw(["bob", "cat", "ann", "dan", "eve"]);
    const state = play(
      { activeSlots: 1, maxSteals: 3 },
      [
        ...addPlayers("ann", "bob", "cat", "dan", "eve"),
        { type: "StartGame" },
        { type: "OpenGift", playerId: "bob", giftId: "g1", name: "Chia Pet" },
        { type: "Steal", playerId: "cat", giftId: "g1" },
        { type: "OpenGift", playerId: "bob", giftId: "g2", name: "Lava Lamp" },
        { type: "Steal", playerId: "ann", giftId: "g1" }, // 2 Steals: still stealable under a limit of 3
        { type: "OpenGift", playerId: "cat", giftId: "g3", name: "Fondue Set" },
        { type: "ChangeSettings", settings: { maxSteals: 2 } }, // game is running long
      ],
      draw,
    );

    expect(isFrozen(state, "g1")).toBe(true);
    expect(decide(state, { type: "Steal", playerId: "dan", giftId: "g1" }, draw)).toMatchObject({
      code: "GiftFrozen",
    });
  });
});

describe("Several active Players", () => {
  it("draws as many On Deck as there are active slots, keeping the On Deck line in order", () => {
    const state = play(
      { activeSlots: 2, maxSteals: 3 },
      [
        ...addPlayers("ann", "bob", "cat", "dan", "eve", "fay"),
        { type: "StartGame" },
        { type: "OpenGift", playerId: "bob", giftId: "g1", name: "Chia Pet" },
      ],
      scriptedDraw(["bob", "cat", "dan", "eve", "fay"]),
    );

    expect(activePlayers(state)).toEqual(["cat", "dan"]);
    expect(onDeck(state)).toEqual(["eve", "fay"]);
  });
});
