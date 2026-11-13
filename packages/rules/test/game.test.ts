import { describe, expect, it } from "vitest";
import {
  activePlayers,
  decide,
  evolve,
  newGame,
  onDeck,
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
      { activeSlots: 1 },
      [...addPlayers("ann", "bob", "cat"), { type: "StartGame" }],
      scriptedDraw(["bob", "cat"]),
    );

    expect(activePlayers(state)).toEqual(["bob"]);
    expect(onDeck(state)).toEqual(["cat"]);
  });
});
