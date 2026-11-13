import { describe, expect, it } from "vitest";
import {
  activePlayers,
  decide,
  evolve,
  holderOf,
  isFrozen,
  leftoverGiftCount,
  newGame,
  onDeck,
  phase,
  pickCount,
  returnedGifts,
  stealCount,
  turnCount,
  type Command,
  type DrawFn,
  type Event,
  type GameSettings,
  type GameState,
} from "../src/index.js";

/** Small seeded random number generator (mulberry32), so a failing seed can be rerun. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Plays a whole Game with random choices, returning the state after every event and the event log. */
function randomGame(seed: number): { settings: GameSettings; history: GameState[]; log: Event[]; giftIds: string[] } {
  const random = seeded(seed);
  const draw: DrawFn = (candidates) => candidates[Math.floor(random() * candidates.length)]!;
  const settings: GameSettings = { activeSlots: 1 + Math.floor(random() * 3), maxSteals: 2 + Math.floor(random() * 2) };
  let state = newGame(settings);
  const log: Event[] = [];
  const history: GameState[] = [];
  const giftIds: string[] = [];

  const run = (command: Command): boolean => {
    const result = decide(state, command, draw);
    if (!Array.isArray(result)) return false;
    for (const event of result) {
      log.push(event);
      state = evolve(state, event);
      history.push(state);
    }
    return true;
  };

  const players = Array.from({ length: 8 + Math.floor(random() * 8) }, (_, i) => `p${i}`);
  for (const id of players) run({ type: "AddPlayer", playerId: id, name: id });
  run({ type: "StartGame" });

  /** One random Pick by the first active Player: try a Steal, otherwise open a new Gift. */
  const pickSomething = () => {
    const player = activePlayers(state)[0]!;
    const target = giftIds[Math.floor(random() * giftIds.length)];
    if (target && random() < 0.4 && run({ type: "Steal", playerId: player, giftId: target })) return;
    if (returnedGifts(state).length > 0 && run({ type: "TakeReturnedGift", playerId: player, giftId: returnedGifts(state)[0]! })) return;
    const giftId = `g${giftIds.length + 1}`;
    if (run({ type: "OpenGift", playerId: player, giftId, name: giftId })) giftIds.push(giftId);
  };

  let moves = 0;
  while (activePlayers(state).length > 0 && moves++ < 500) {
    pickSomething();
    if (random() < 0.05) run({ type: "Undo" });
    if (moves === 10) run({ type: "ChangeSettings", settings: { maxSteals: 2 } });
    if (moves === 5 && onDeck(state)[0]) run({ type: "Skip", playerId: onDeck(state)[0]! });
    if (moves === 15) run({ type: "AddPlayer", playerId: "late", name: "Late Arrival" });
    if (moves === 20 && onDeck(state)[0]) run({ type: "RemovePlayer", playerId: onDeck(state)[0]! });
  }

  run({ type: "StartFinalRound", finalists: 2, leftoverGifts: 1 });
  moves = 0;
  while (activePlayers(state).length > 0 && moves++ < 500) {
    const player = activePlayers(state)[0]!;
    if (random() < 0.3 && run({ type: "KeepGift", playerId: player })) continue;
    pickSomething();
  }
  run({ type: "EndGame" });

  return { settings, history, log, giftIds };
}

/** Everything the screens can ask about a Game. */
function answers(state: GameState, giftIds: string[]) {
  return {
    phase: phase(state),
    active: activePlayers(state),
    onDeck: onDeck(state),
    turns: turnCount(state),
    picks: pickCount(state),
    leftover: leftoverGiftCount(state),
    returned: returnedGifts(state),
    gifts: giftIds.map((id) => ({
      id,
      holder: holderOf(state, id),
      steals: stealCount(state, id),
      frozen: isFrozen(state, id),
    })),
  };
}

describe("Replay", () => {
  it.each(Array.from({ length: 50 }, (_, i) => i + 1))(
    "rebuilding Game #%i from its log alone gives the same answers after every event, with no Draws re-run",
    (seed) => {
      const { settings, history, log, giftIds } = randomGame(seed);
      expect(phase(history.at(-1)!)).toBe("ended"); // the simulated Game really ran to the end

      let replayed = newGame(settings);
      log.forEach((event, i) => {
        replayed = evolve(replayed, event);
        expect(answers(replayed, giftIds), `after event ${i}: ${event.type}`).toEqual(answers(history[i]!, giftIds));
      });
    },
  );

  it("the simulated Games exercise every kind of event", () => {
    const seen = new Set(Array.from({ length: 50 }, (_, i) => randomGame(i + 1).log.map((e) => e.type)).flat());
    expect([...seen].sort()).toEqual(
      [
        "PlayerAdded", "GameStarted", "PlayerDrawn", "GiftOpened", "GiftStolen", "SettingsChanged",
        "PlayerSkipped", "PlayerRemoved",
        "PickUndone", "FinalRoundStarted", "GiftKept", "ReturnedGiftTaken", "GameEnded",
      ].sort(),
    );
  });
});
