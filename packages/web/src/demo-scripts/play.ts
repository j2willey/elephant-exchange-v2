/**
 * The parts of a guided demo that need no server: turning a script's actions into the rules' Commands, checking a
 * step's `expect` against a Game, and playing a whole script through the rules alone (`validate`).
 *
 * The guided replay (runner.ts) uses the same `commandFor` and `checkExpect` against the real server, so a script
 * that validates here plays the same there. `validate` also works out, before every action, how many of the
 * script's Draws have been made, which is how the replay knows which Draws to send with each command (ADR 0006).
 */
import { decide, evolve, gifts as giftsOf, leftoverGiftCount, newGame, phase, type Command, type GameState, type Phase } from "@elephant/rules";
import type { Action, DemoScript, Expect } from "./format.js";

/** The ids the script's names and Gift keys stand for, in one Game. */
export interface Ids {
  player(name: string): string;
  gift(key: string): string;
}

/** The game Command an action sends, or undefined for an action that isn't a game move (a Post, a Pitch…). */
export function commandFor(script: DemoScript, action: Action, ids: Ids): Command | undefined {
  const about = (key: string) => {
    const gift = script.gifts[key];
    if (!gift) throw new Error(`no gift "${key}" in the script`);
    return gift;
  };
  switch (action.do) {
    case "startGame":
      return { type: "StartGame" };
    case "open": {
      const gift = about(action.gift);
      const description = action.unnamed ? "" : (gift.description ?? "");
      return { type: "OpenGift", playerId: ids.player(action.player), giftId: ids.gift(action.gift), name: action.unnamed ? "" : gift.name, ...(description ? { description } : {}) };
    }
    case "describe": {
      const gift = about(action.gift);
      return { type: "DescribeGift", giftId: ids.gift(action.gift), name: gift.name, description: gift.description ?? "" };
    }
    case "steal":
      return { type: "Steal", playerId: ids.player(action.player), giftId: ids.gift(action.gift) };
    case "skip":
      return { type: "Skip", playerId: ids.player(action.player) };
    case "startFinalRound":
      return { type: "StartFinalRound", finalists: action.finalists, leftoverGifts: action.leftoverGifts };
    case "keep":
      return { type: "KeepGift", playerId: ids.player(action.player) };
    case "takeReturned":
      return { type: "TakeReturnedGift", playerId: ids.player(action.player), giftId: ids.gift(action.gift) };
    case "undo":
      return { type: "Undo" };
    case "endGame":
      return { type: "EndGame" };
    default:
      return undefined;
  }
}

/** What `expect` looks at: the same from the rules' state and from the server's GameView. */
export interface GameLook {
  phase: Phase;
  active: string[];
  onDeck: string[];
  gifts: { id: string; holderId: string | null; steals: number; frozen: boolean }[];
  leftoverGifts: number;
}

export function lookOf(state: GameState): GameLook {
  return { phase: phase(state), active: state.active, onDeck: state.onDeck, gifts: giftsOf(state), leftoverGifts: leftoverGiftCount(state) };
}

const asList = (v: string | string[] | undefined) => (v === undefined ? undefined : Array.isArray(v) ? v : v === "" ? [] : [v]);

/**
 * How the Game differs from what the step expects, in words ("up: Ben, not Cat"); empty when it all holds. Only
 * what `expect` lists is checked. `name` and `giftKey` turn the Game's ids back into the script's names and keys.
 */
export function checkExpect(expect: Expect | undefined, game: GameLook, ids: Ids, name: (playerId: string) => string): string[] {
  if (!expect) return [];
  const out: string[] = [];
  const names = (playerIds: string[]) => playerIds.map(name).join(", ") || "nobody";
  if (expect.phase && game.phase !== expect.phase) out.push(`phase: ${game.phase}, not ${expect.phase}`);
  const up = asList(expect.up);
  if (up && names(game.active) !== (up.join(", ") || "nobody")) out.push(`up: ${names(game.active)}, not ${up.join(", ") || "nobody"}`);
  const onDeck = asList(expect.onDeck);
  if (onDeck && names(game.onDeck) !== (onDeck.join(", ") || "nobody")) out.push(`On Deck: ${names(game.onDeck)}, not ${onDeck.join(", ") || "nobody"}`);
  const gift = (key: string) => game.gifts.find((g) => g.id === ids.gift(key));
  for (const [key, holder] of Object.entries(expect.holders ?? {})) {
    const g = gift(key);
    const has = !g ? "unopened" : g.holderId === null ? "the table" : name(g.holderId);
    const want = holder === null ? "the table" : holder;
    if (has !== want) out.push(`${key}: with ${has}, not ${want}`);
  }
  for (const key of expect.frozen ?? []) if (!gift(key)?.frozen) out.push(`${key}: not Frozen`);
  for (const [key, n] of Object.entries(expect.steals ?? {})) {
    const has = gift(key)?.steals ?? 0;
    if (has !== n) out.push(`${key}: stolen ${has} times, not ${n}`);
  }
  if (expect.leftoverGifts !== undefined && game.leftoverGifts !== expect.leftoverGifts) out.push(`Leftover Gifts: ${game.leftoverGifts}, not ${expect.leftoverGifts}`);
  return out;
}

export interface Validation {
  /** Everything wrong with the script, each naming its step. Empty for a good script. */
  problems: string[];
  /**
   * For each step, for each of its actions: how many of the script's Draws had been made just before it. The replay
   * sends `draws.slice(n)` with that action's command.
   */
  drawsBefore: number[][];
}

/**
 * Plays a script through the rules alone, with its scripted Draws, and checks every step. Stops at the first action
 * the rules refuse. Posts, Reactions, Pitches and screen switches aren't game moves, so only their references are
 * checked (that the Player, Gift, Photo and Post they name exist).
 */
export function validate(script: DemoScript): Validation {
  const problems: string[] = [];
  const drawsBefore: number[][] = [];
  const players = new Set(script.players);
  if (players.size !== script.players.length) problems.push("players: a name is listed twice");
  const stepIds = new Set<string>();
  for (const step of script.steps) {
    if (stepIds.has(step.id)) problems.push(`${step.id}: the step id is used twice`);
    stepIds.add(step.id);
  }

  // In the rules alone, a Player's id is their name and a Gift's is its key.
  const ids: Ids = { player: (n) => n, gift: (k) => k };
  let used = 0;
  let drawProblem: string | undefined;
  const draw = (candidates: string[]) => {
    const next = script.draws[used];
    if (next === undefined || !candidates.includes(next)) {
      drawProblem = `the Draw can pick ${candidates.join(", ")}; the script says ${next ?? "nobody (draws ran out)"}`;
      return candidates[0]!;
    }
    used++;
    return next;
  };
  let state = newGame({ activeSlots: script.game.options.activeSlots, maxSteals: script.game.options.maxSteals });
  for (const name of script.players) {
    const r = decide(state, { type: "AddPlayer", playerId: name, name }, draw);
    if (!Array.isArray(r)) return { problems: [...problems, `players: ${r.message}`], drawsBefore };
    state = r.reduce(evolve, state);
  }

  const refs = new Set<string>();
  for (const step of script.steps) {
    const mine: number[] = [];
    drawsBefore.push(mine);
    for (const action of step.actions ?? []) {
      mine.push(used);
      const where = `${step.id} (${action.do})`;
      const known = (name: string | undefined) => name === undefined || players.has(name) || void problems.push(`${where}: no player "${name}"`);
      const gift = (key: string | undefined) => key === undefined || key in script.gifts || void problems.push(`${where}: no gift "${key}"`);
      const photo = (key: string | undefined) => key === undefined || key in (script.photos ?? {}) || void problems.push(`${where}: no photo "${key}"`);
      if ("player" in action) known(action.player);
      if ("gift" in action) gift(action.gift);
      if (action.do === "post") {
        known(action.as);
        photo(action.photo);
        if (action.replyTo && !refs.has(action.replyTo)) problems.push(`${where}: replies to "${action.replyTo}", which isn't posted before it`);
        if (action.ref) refs.add(action.ref);
      }
      if (action.do === "react") {
        known(action.as);
        if (!refs.has(action.post)) problems.push(`${where}: reacts to "${action.post}", which isn't posted before it`);
      }
      if (action.do === "pitch") {
        known(action.holder);
        photo(action.photo);
      }
      const command = commandFor(script, action, ids);
      if (!command) continue;
      drawProblem = undefined;
      const r = decide(state, command, draw);
      if (drawProblem) problems.push(`${where}: ${drawProblem}`);
      if (!Array.isArray(r)) return { problems: [...problems, `${where}: the rules refuse it: ${r.message}`], drawsBefore };
      state = r.reduce(evolve, state);
    }
    for (const failed of checkExpect(step.expect, lookOf(state), ids, (id) => id)) problems.push(`${step.id}: ${failed}`);
    const target = step.bubble.target;
    const [kind, arg] = target.split(":") as [string, string | undefined];
    if (arg !== undefined) {
      if (kind === "gift-row" || kind === "name-gift" || kind === "edit-gift") {
        if (!(arg in script.gifts)) problems.push(`${step.id}: the bubble points at gift "${arg}", which isn't in the script`);
      } else if (kind === "post") {
        if (!refs.has(arg)) problems.push(`${step.id}: the bubble points at post "${arg}", which isn't posted yet`);
      } else if (!players.has(arg)) problems.push(`${step.id}: the bubble points at player "${arg}", who isn't in the script`);
    }
  }
  if (used < script.draws.length) problems.push(`draws: ${script.draws.length - used} left over (${script.draws.slice(used).join(", ")})`);
  return { problems, drawsBefore };
}
