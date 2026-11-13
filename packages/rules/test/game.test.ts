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

function evolveAll(state: GameState, result: ReturnType<typeof decide>): GameState {
  if (!Array.isArray(result)) throw new Error(`RuleError: ${result.message}`);
  return result.reduce(evolve, state);
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

describe("Changing the number of active slots mid-Game", () => {
  it("lowering the slots keeps everyone active; On Deck moves up only once the active count is below the new limit", () => {
    const state = play(
      { activeSlots: 3, maxSteals: 3 },
      [
        ...addPlayers("ann", "bob", "cat", "dan", "eve", "fay", "gus", "hal"),
        { type: "StartGame" },
        { type: "ChangeSettings", settings: { activeSlots: 1 } },
        { type: "OpenGift", playerId: "bob", giftId: "g1", name: "Chia Pet" },
        { type: "OpenGift", playerId: "cat", giftId: "g2", name: "Lava Lamp" },
      ],
      // Exactly six Draws: lowering must not trigger any more.
      scriptedDraw(["bob", "cat", "dan", "eve", "fay", "gus"]),
    );

    expect(activePlayers(state)).toEqual(["dan"]);
    expect(onDeck(state)).toEqual(["eve", "fay", "gus"]);
  });

  it("once the last over-limit Player opens a Gift, the next On Deck Player becomes active", () => {
    const state = play(
      { activeSlots: 3, maxSteals: 3 },
      [
        ...addPlayers("ann", "bob", "cat", "dan", "eve", "fay", "gus", "hal"),
        { type: "StartGame" },
        { type: "ChangeSettings", settings: { activeSlots: 1 } },
        { type: "OpenGift", playerId: "bob", giftId: "g1", name: "Chia Pet" },
        { type: "OpenGift", playerId: "cat", giftId: "g2", name: "Lava Lamp" },
        { type: "OpenGift", playerId: "dan", giftId: "g3", name: "Fondue Set" },
      ],
      scriptedDraw(["bob", "cat", "dan", "eve", "fay", "gus"]),
    );

    expect(activePlayers(state)).toEqual(["eve"]);
    expect(onDeck(state)).toEqual(["fay", "gus"]);
  });

  it("raising the slots fills them immediately, plus the same number On Deck", () => {
    const state = play(
      { activeSlots: 1, maxSteals: 3 },
      [
        ...addPlayers("ann", "bob", "cat", "dan", "eve", "fay", "gus", "hal"),
        { type: "StartGame" },
        { type: "ChangeSettings", settings: { activeSlots: 3 } },
      ],
      scriptedDraw(["bob", "cat", "dan", "eve", "fay", "gus"]),
    );

    expect(activePlayers(state)).toEqual(["bob", "cat", "dan"]);
    expect(onDeck(state)).toEqual(["eve", "fay", "gus"]);
  });
});

describe("Only active Players can Pick", () => {
  const draw = () => scriptedDraw(["bob", "cat", "ann"]);
  const started = () =>
    play(
      { activeSlots: 1, maxSteals: 3 },
      [...addPlayers("ann", "bob", "cat", "dan"), { type: "StartGame" }],
      draw(),
    );

  it("rejects a Player who has not been called yet", () => {
    const result = decide(started(), { type: "OpenGift", playerId: "dan", giftId: "g1", name: "Socks" }, draw());
    expect(result).toMatchObject({ code: "NotActive" });
  });

  it("rejects a Player who is only On Deck", () => {
    const result = decide(started(), { type: "OpenGift", playerId: "cat", giftId: "g1", name: "Socks" }, draw());
    expect(result).toMatchObject({ code: "NotActive" });
  });

  it("rejects a Player who already finished their Turn", () => {
    const d = draw();
    const state = play(
      { activeSlots: 1, maxSteals: 3 },
      [
        ...addPlayers("ann", "bob", "cat", "dan"),
        { type: "StartGame" },
        { type: "OpenGift", playerId: "bob", giftId: "g1", name: "Chia Pet" },
      ],
      d,
    );
    const result = decide(state, { type: "Steal", playerId: "bob", giftId: "g1" }, d);
    expect(result).toMatchObject({ code: "NotActive" });
  });

  it("rejects stealing a Gift that hasn't been opened", () => {
    const result = decide(started(), { type: "Steal", playerId: "bob", giftId: "nope" }, draw());
    expect(result).toMatchObject({ code: "GiftNotOpened" });
  });
});

describe("Late Arrivals", () => {
  it("are drawn On Deck straight away when the On Deck line has room", () => {
    const draw = scriptedDraw(["bob", "ann", "zed"]);
    const state = play(
      { activeSlots: 1, maxSteals: 3 },
      [
        ...addPlayers("ann", "bob"),
        { type: "StartGame" },
        { type: "OpenGift", playerId: "bob", giftId: "g1", name: "Chia Pet" }, // Ann moves up; nobody left to draw
        ...addPlayers("zed"),
      ],
      draw,
    );

    expect(activePlayers(state)).toEqual(["ann"]);
    expect(onDeck(state)).toEqual(["zed"]);
  });
});

describe("Skip", () => {
  it("returns an absent called Player to the pool and draws a replacement from everyone else", () => {
    const draw = recordingDraw(scriptedDraw(["bob", "cat", "ann", "bob"]));
    const state = play(
      { activeSlots: 1, maxSteals: 3 },
      [
        ...addPlayers("ann", "bob", "cat", "dan"),
        { type: "StartGame" },
        { type: "Skip", playerId: "bob" }, // Bob is in the bathroom
      ],
      draw,
    );

    expect(activePlayers(state)).toEqual(["cat"]);
    expect(onDeck(state)).toEqual(["ann"]);
    expect(draw.offered.at(-1)).toEqual(["ann", "dan"]); // not Bob, or the Skip could draw him straight back

    const later = evolveAll(state, decide(state, { type: "OpenGift", playerId: "cat", giftId: "g1", name: "Chia Pet" }, draw));
    expect(draw.offered.at(-1)).toEqual(["bob", "dan"]); // Bob is back in the pool
    expect(onDeck(later)).toEqual(["bob"]);
  });

  it("rejects skipping a Victim, who has already played", () => {
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

    expect(decide(state, { type: "Skip", playerId: "bob" }, draw)).toMatchObject({ code: "AlreadyPlayed" });
  });
});

describe("Remove", () => {
  it("takes a Player who left early out of the Game, drawing a replacement if they were On Deck", () => {
    const draw = recordingDraw(scriptedDraw(["bob", "cat", "ann", "dan"]));
    const state = play(
      { activeSlots: 1, maxSteals: 3 },
      [
        ...addPlayers("ann", "bob", "cat", "dan"),
        { type: "StartGame" },
        { type: "RemovePlayer", playerId: "cat" }, // Cat had to leave
        { type: "OpenGift", playerId: "bob", giftId: "g1", name: "Chia Pet" },
      ],
      draw,
    );

    expect(activePlayers(state)).toEqual(["ann"]);
    expect(onDeck(state)).toEqual(["dan"]);
    expect(draw.offered.slice(2).flat()).not.toContain("cat"); // the first two Draws were at the start
    expect(draw.offered.at(2)).toEqual(["ann", "dan"]);
  });

  it("rejects removing a Player who holds a Gift", () => {
    const draw = scriptedDraw(["bob", "cat", "ann"]);
    const state = play(
      { activeSlots: 1, maxSteals: 3 },
      [
        ...addPlayers("ann", "bob", "cat", "dan"),
        { type: "StartGame" },
        { type: "OpenGift", playerId: "bob", giftId: "g1", name: "Chia Pet" },
      ],
      draw,
    );

    expect(decide(state, { type: "RemovePlayer", playerId: "bob" }, draw)).toMatchObject({ code: "AlreadyPlayed" });
  });
});

describe("Undo", () => {
  it("reverses an opened Gift, returning anyone it caused to be drawn to the pool", () => {
    const draw = recordingDraw(scriptedDraw(["bob", "cat", "ann", "dan"]));
    const state = play(
      { activeSlots: 1, maxSteals: 3 },
      [
        ...addPlayers("ann", "bob", "cat", "dan"),
        { type: "StartGame" },
        { type: "OpenGift", playerId: "bob", giftId: "g1", name: "Chia Pet" }, // drew Ann On Deck
        { type: "Undo" }, // wrong Player tapped
      ],
      draw,
    );

    expect(activePlayers(state)).toEqual(["bob"]);
    expect(onDeck(state)).toEqual(["cat"]);
    expect(holderOf(state, "g1")).toBeUndefined();
    expect(turnCount(state)).toBe(0);
    expect(pickCount(state)).toBe(0);

    evolveAll(state, decide(state, { type: "OpenGift", playerId: "bob", giftId: "g1", name: "Chia Pet" }, draw));
    expect(draw.offered.at(-1)).toEqual(["ann", "dan"]); // a fresh Draw: Ann is back in the pool
  });

  const stolen = (draw: DrawFn) =>
    play(
      { activeSlots: 1, maxSteals: 1 },
      [
        ...addPlayers("ann", "bob", "cat", "dan"),
        { type: "StartGame" },
        { type: "OpenGift", playerId: "bob", giftId: "g1", name: "Chia Pet" },
        { type: "Steal", playerId: "cat", giftId: "g1" }, // Freezes it (limit 1)
      ],
      draw,
    );

  it("reverses a Steal, un-Freezing the Gift and ending the Victim's turn to act", () => {
    const draw = scriptedDraw(["bob", "cat", "ann"]);
    const before = stolen(draw);
    const state = evolveAll(before, decide(before, { type: "Undo" }, draw));

    expect(holderOf(state, "g1")).toBe("bob");
    expect(isFrozen(state, "g1")).toBe(false);
    expect(activePlayers(state)).toEqual(["cat"]);
    expect(pickCount(state)).toBe(1);
  });

  it("only reverses the last Pick: a second Undo is refused", () => {
    const draw = scriptedDraw(["bob", "cat", "ann"]);
    const before = stolen(draw);
    const once = evolveAll(before, decide(before, { type: "Undo" }, draw));

    expect(decide(once, { type: "Undo" }, draw)).toMatchObject({ code: "NothingToUndo" });
  });

  it("is refused once anything else has changed since the Pick", () => {
    const draw = scriptedDraw(["bob", "cat", "ann", "zed"]);
    const state = play(
      { activeSlots: 1, maxSteals: 3 },
      [
        ...addPlayers("ann", "bob", "cat"),
        { type: "StartGame" },
        { type: "OpenGift", playerId: "bob", giftId: "g1", name: "Chia Pet" },
        { type: "ChangeSettings", settings: { maxSteals: 2 } },
      ],
      draw,
    );

    expect(decide(state, { type: "Undo" }, draw)).toMatchObject({ code: "NothingToUndo" });
  });
});
