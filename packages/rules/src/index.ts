export type PlayerId = string;
export type GiftId = string;

export interface GameSettings {
  /** How many Players may take Turns at the same time. */
  activeSlots: number;
  /** A Gift is Frozen by the Steal that brings its count to this number. */
  maxSteals: number;
}

/** Picks one Player from the candidates. The server passes real randomness; tests pass a script. */
export type DrawFn = (candidates: PlayerId[]) => PlayerId;

export type Command =
  | { type: "AddPlayer"; playerId: PlayerId; name: string }
  | { type: "StartGame" }
  | { type: "OpenGift"; playerId: PlayerId; giftId: GiftId; name: string; description?: string }
  | { type: "Steal"; playerId: PlayerId; giftId: GiftId }
  | { type: "ChangeSettings"; settings: Partial<GameSettings> }
  | { type: "Skip"; playerId: PlayerId }
  | { type: "RemovePlayer"; playerId: PlayerId }
  | { type: "Undo" }
  | { type: "StartFinalRound"; finalists: number; leftoverGifts: number }
  | { type: "KeepGift"; playerId: PlayerId }
  | { type: "TakeReturnedGift"; playerId: PlayerId; giftId: GiftId }
  | { type: "EndGame" }
  /** Corrects what an opened Gift is called or adds detail; allowed at any time, even after the Game ends. */
  | { type: "DescribeGift"; giftId: GiftId; name: string; description: string }
  | { type: "RenamePlayer"; playerId: PlayerId; name: string };

/** What actually happened; these are what the Game's log stores. */
export type Event =
  | { type: "PlayerAdded"; playerId: PlayerId; name: string }
  | { type: "GameStarted" }
  | { type: "PlayerDrawn"; playerId: PlayerId }
  | { type: "GiftOpened"; playerId: PlayerId; giftId: GiftId; name: string; description?: string }
  | { type: "GiftStolen"; playerId: PlayerId; giftId: GiftId; fromPlayerId: PlayerId }
  | { type: "SettingsChanged"; settings: Partial<GameSettings> }
  | { type: "PlayerSkipped"; playerId: PlayerId }
  | { type: "PlayerRemoved"; playerId: PlayerId }
  | { type: "PickUndone" }
  | { type: "FinalRoundStarted"; finalists: PlayerId[]; leftoverGifts: number }
  | { type: "GiftKept"; playerId: PlayerId }
  | { type: "ReturnedGiftTaken"; playerId: PlayerId; giftId: GiftId }
  | { type: "GameEnded" }
  | { type: "GiftDescribed"; giftId: GiftId; name: string; description: string }
  | { type: "PlayerRenamed"; playerId: PlayerId; name: string };

export type RuleErrorCode = "NotActive" | "AlreadyPlayed" | "GiftOnTable" | "NotReturned" | "NoLeftoverGifts" | "TurnsInProgress" | "NothingToKeep" | "GameOver" | "NothingToUndo" | "GiftNotOpened" | "GiftFrozen" | "NoTakeBacks" | "NoSuchPlayer" | "WrongPhase" | "OwnGift";

export interface RuleError {
  code: RuleErrorCode;
  message: string;
}

interface Player {
  id: PlayerId;
  name: string;
}

interface Gift {
  id: GiftId;
  name: string;
  /** Detail beyond the name ("Breville, barely used"); empty when there is none. */
  description: string;
  /** Null only for a Returned Gift, back on the table during the Final Round. */
  holderId: PlayerId | null;
  /** Who opened it; names a Gift opened without a name ("Ann's gift"), even after it's stolen. */
  openedBy: PlayerId;
  steals: number;
}

export type Phase = "setup" | "playing" | "finalRound" | "ended";

export interface GameState {
  settings: GameSettings;
  phase: Phase;
  /** Unopened Gifts still on the table; counted by the Host when the Final Round starts. */
  leftoverGifts: number;
  players: Player[];
  /** Every Player ever drawn, in order; never offered to the Draw again. */
  called: PlayerId[];
  /**
   * Players who must act now: drawn Players and Victims. Can exceed activeSlots after the
   * Host lowers it; nobody is taken out of action, the limit applies as they finish.
   */
  active: PlayerId[];
  /** Drawn Players waiting for an active slot, in the order they were drawn. */
  onDeck: PlayerId[];
  /** For each Victim, the Gift just taken from them, which they may not steal straight back. */
  takenFrom: Record<PlayerId, GiftId>;
  gifts: Gift[];
  picks: number;
  /** The state just before the most recent Pick, while that Pick can still be undone. */
  beforeLastPick: GameState | null;
}

export function newGame(settings: GameSettings): GameState {
  return { settings, phase: "setup", leftoverGifts: 0, players: [], called: [], active: [], onDeck: [], takenFrom: {}, gifts: [], picks: 0, beforeLastPick: null };
}

export function decide(state: GameState, command: Command, draw: DrawFn): Event[] | RuleError {
  if (command.type === "DescribeGift") {
    if (!state.gifts.some((g) => g.id === command.giftId)) return { code: "GiftNotOpened", message: `No opened Gift ${command.giftId}` };
    return [{ type: "GiftDescribed", giftId: command.giftId, name: command.name, description: command.description }];
  }
  if (command.type === "RenamePlayer") {
    // Like correcting a Gift: allowed at any time, even after the Game ends, and never undone.
    if (!state.players.some((p) => p.id === command.playerId)) return { code: "NoSuchPlayer", message: "There's no such Player in this Game" };
    return [{ type: "PlayerRenamed", playerId: command.playerId, name: command.name }];
  }
  if (state.phase === "ended") return { code: "GameOver", message: "The Game has ended" };
  const isPick =
    command.type === "OpenGift" ||
    command.type === "Steal" ||
    command.type === "KeepGift" ||
    command.type === "TakeReturnedGift";
  if (isPick && !state.active.includes(command.playerId)) {
    return { code: "NotActive", message: "It isn't this Player's Turn" };
  }
  switch (command.type) {
    case "AddPlayer":
      return withDraws(state, [{ type: "PlayerAdded", playerId: command.playerId, name: command.name }], draw);
    case "StartGame":
      // A stale console could send it again: never put a Game under way (or a Final Round) back to its start.
      if (state.phase !== "setup") return { code: "WrongPhase", message: "The Game has already started" };
      return withDraws(state, [{ type: "GameStarted" }], draw);
    case "OpenGift":
      if (state.phase === "finalRound" && state.leftoverGifts === 0) {
        return { code: "NoLeftoverGifts", message: "There are no unopened Gifts left on the table" };
      }
      return withDraws(
        state,
        [
          {
            type: "GiftOpened",
            playerId: command.playerId,
            giftId: command.giftId,
            name: command.name,
            ...(command.description ? { description: command.description } : {}),
          },
        ],
        draw,
      );
    case "Steal": {
      const gift = state.gifts.find((g) => g.id === command.giftId);
      if (!gift) return { code: "GiftNotOpened", message: `No opened Gift ${command.giftId}` };
      if (gift.holderId === command.playerId) {
        return { code: "OwnGift", message: "That's your own Gift: keep it, or put it back and take another" };
      }
      if (gift.holderId === null) {
        return { code: "GiftOnTable", message: `${giftLabel(state, gift.id)} is on the table: take it, don't steal it` };
      }
      if (gift.steals >= state.settings.maxSteals) {
        return { code: "GiftFrozen", message: `${giftLabel(state, gift.id)} is Frozen and can't be stolen` };
      }
      if (state.takenFrom[command.playerId] === gift.id) {
        return { code: "NoTakeBacks", message: "You can't steal back the Gift just taken from you" };
      }
      return [
        { type: "GiftStolen", playerId: command.playerId, giftId: gift.id, fromPlayerId: gift.holderId },
      ];
    }
    case "ChangeSettings":
      return withDraws(state, [{ type: "SettingsChanged", settings: command.settings }], draw);
    case "Skip":
      if (command.playerId in state.takenFrom) {
        return { code: "AlreadyPlayed", message: "A Victim has already played and can't be skipped" };
      }
      // The replacement comes from everyone else, or the Skip could draw the same Player straight back.
      return withDraws(state, [{ type: "PlayerSkipped", playerId: command.playerId }], draw, command.playerId);
    case "RemovePlayer":
      if (command.playerId in state.takenFrom || state.gifts.some((g) => g.holderId === command.playerId)) {
        return { code: "AlreadyPlayed", message: "A Player who has already played can't be removed" };
      }
      return withDraws(state, [{ type: "PlayerRemoved", playerId: command.playerId }], draw);
    case "Undo":
      if (!state.beforeLastPick) return { code: "NothingToUndo", message: "There is no Pick to undo" };
      return [{ type: "PickUndone" }];
    case "StartFinalRound": {
      // Once only, and only from regular play: a second one would give the Finalists another chance.
      if (state.phase !== "playing") {
        return { code: "WrongPhase", message: state.phase === "setup" ? "The Game hasn't started yet" : "The Final Round has already started" };
      }
      if (state.active.length > 0) {
        return { code: "TurnsInProgress", message: "Wait until every active Player has a Gift" };
      }
      const finalists = state.called
        .filter((id) => state.gifts.some((g) => g.holderId === id))
        .slice(0, command.finalists);
      return [{ type: "FinalRoundStarted", finalists, leftoverGifts: command.leftoverGifts }];
    }
    case "EndGame":
      // The Host's call, at any moment: the room booking may simply run out.
      return [{ type: "GameEnded" }];
    case "KeepGift":
      if (!state.gifts.some((g) => g.holderId === command.playerId)) {
        return { code: "NothingToKeep", message: "This Player has no Gift to keep" };
      }
      return [{ type: "GiftKept", playerId: command.playerId }];
    case "TakeReturnedGift": {
      const gift = state.gifts.find((g) => g.id === command.giftId);
      if (!gift || gift.holderId !== null) {
        return { code: "NotReturned", message: "That Gift isn't on the table" };
      }
      return [{ type: "ReturnedGiftTaken", playerId: command.playerId, giftId: gift.id }];
    }
  }
}

export function evolve(state: GameState, event: Event): GameState {
  const next = apply(state, event);
  // Undo covers only a Pick and the Draws it caused; any other change closes the window.
  const keepsUndo =
    event.type === "GiftOpened" ||
    event.type === "GiftStolen" ||
    event.type === "ReturnedGiftTaken" ||
    event.type === "PlayerDrawn" ||
    event.type === "GiftDescribed" ||
    event.type === "PlayerRenamed";
  return keepsUndo ? next : { ...next, beforeLastPick: null };
}

/**
 * A Final Round Player who doesn't keep their Gift puts it back on the table first, then steals, opens a wrapped
 * one, or takes one from the table: they never hold two. Anyone else taking a Gift holds none, so nothing moves.
 */
function putBack(gifts: Gift[], playerId: PlayerId): Gift[] {
  return gifts.map((g) => (g.holderId === playerId ? { ...g, holderId: null } : g));
}

function apply(state: GameState, event: Event): GameState {
  switch (event.type) {
    case "PlayerAdded":
      return { ...state, players: [...state.players, { id: event.playerId, name: event.name }] };
    case "GameStarted":
      return { ...state, phase: "playing" };
    case "FinalRoundStarted":
      // Final Round Players wait On Deck, in call order, and take their chance one at a time.
      return moveUp({
        ...state,
        phase: "finalRound",
        leftoverGifts: event.leftoverGifts,
        onDeck: event.finalists,
      });
    case "PlayerDrawn":
      return moveUp({
        ...state,
        called: [...state.called, event.playerId],
        onDeck: [...state.onDeck, event.playerId],
      });
    case "GiftOpened":
      return moveUp({
        ...state,
        beforeLastPick: { ...state, beforeLastPick: null },
        active: state.active.filter((id) => id !== event.playerId),
        takenFrom: without(state.takenFrom, event.playerId),
        gifts: [...putBack(state.gifts, event.playerId), { id: event.giftId, name: event.name, description: event.description ?? "", holderId: event.playerId, openedBy: event.playerId, steals: 0 }],
        leftoverGifts: state.phase === "finalRound" ? state.leftoverGifts - 1 : state.leftoverGifts,
        picks: state.picks + 1,
      });
    case "GiftStolen":
      return {
        ...state,
        beforeLastPick: { ...state, beforeLastPick: null },
        // The stealer is done; the Victim takes their place, whatever the slot limit.
        active: [...state.active.filter((id) => id !== event.playerId), event.fromPlayerId],
        takenFrom: { ...without(state.takenFrom, event.playerId), [event.fromPlayerId]: event.giftId },
        gifts: state.gifts.map((g) =>
          g.id === event.giftId
            ? { ...g, holderId: event.playerId, steals: g.steals + 1 }
            : g.holderId === event.playerId
              ? { ...g, holderId: null } // a Final Round stealer's own Gift goes back on the table
              : g,
        ),
        picks: state.picks + 1,
      };
    case "SettingsChanged":
      return moveUp({ ...state, settings: { ...state.settings, ...event.settings } });
    case "ReturnedGiftTaken":
      return moveUp({
        ...state,
        beforeLastPick: { ...state, beforeLastPick: null },
        active: state.active.filter((id) => id !== event.playerId),
        takenFrom: without(state.takenFrom, event.playerId),
        gifts: putBack(state.gifts, event.playerId).map((g) => (g.id === event.giftId ? { ...g, holderId: event.playerId } : g)),
        picks: state.picks + 1,
      });
    case "GiftDescribed": {
      const describe = (g: Gift): Gift => (g.id === event.giftId ? { ...g, name: event.name, description: event.description } : g);
      // An Undo after a correction keeps the correction.
      const before = state.beforeLastPick && { ...state.beforeLastPick, gifts: state.beforeLastPick.gifts.map(describe) };
      return { ...state, gifts: state.gifts.map(describe), beforeLastPick: before };
    }
    case "PlayerRenamed": {
      const rename = (p: Player): Player => (p.id === event.playerId ? { ...p, name: event.name } : p);
      // An Undo after a rename keeps the new name.
      const before = state.beforeLastPick && { ...state.beforeLastPick, players: state.beforeLastPick.players.map(rename) };
      return { ...state, players: state.players.map(rename), beforeLastPick: before };
    }
    case "GameEnded":
      return { ...state, phase: "ended", active: [], onDeck: [] };
    case "GiftKept":
      return moveUp({ ...state, active: state.active.filter((id) => id !== event.playerId) });
    case "PickUndone":
      // The Draws the Pick caused are undone with it; the redo gets a fresh Draw.
      return state.beforeLastPick ?? state;
    case "PlayerRemoved":
      return moveUp({
        ...state,
        players: state.players.filter((p) => p.id !== event.playerId),
        called: state.called.filter((id) => id !== event.playerId),
        active: state.active.filter((id) => id !== event.playerId),
        onDeck: state.onDeck.filter((id) => id !== event.playerId),
      });
    case "PlayerSkipped":
      return moveUp({
        ...state,
        called: state.called.filter((id) => id !== event.playerId),
        active: state.active.filter((id) => id !== event.playerId),
        onDeck: state.onDeck.filter((id) => id !== event.playerId),
      });
  }
}

function without<V>(record: Record<PlayerId, V>, key: PlayerId): Record<PlayerId, V> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

/** Players never yet drawn: the pool for the next Draw. */
function notYetCalled(state: GameState): PlayerId[] {
  return state.players.map((p) => p.id).filter((id) => !state.called.includes(id));
}

/** On Deck Players move up while the active count is below the slot limit. */
function moveUp(state: GameState): GameState {
  const active = [...state.active];
  const onDeck = [...state.onDeck];
  const limit = state.phase === "finalRound" ? 1 : state.settings.activeSlots;
  while (active.length < limit && onDeck.length > 0) {
    active.push(onDeck.shift()!);
  }
  return { ...state, active, onDeck };
}

/**
 * Appends Draws after the given events until the active slots are full and the On Deck line
 * holds as many Players as there are slots (or nobody is left to draw).
 */
function withDraws(state: GameState, events: Event[], draw: DrawFn, exclude?: PlayerId): Event[] {
  let next = events.reduce(evolve, state);
  const all = [...events];
  if (next.phase !== "playing") return all;
  const slots = next.settings.activeSlots;
  const drawable = (s: GameState) => notYetCalled(s).filter((id) => id !== exclude);
  let pool = drawable(next);
  while ((next.active.length < slots || next.onDeck.length < slots) && pool.length > 0) {
    const drawn: Event = { type: "PlayerDrawn", playerId: draw(pool) };
    all.push(drawn);
    next = evolve(next, drawn);
    pool = drawable(next);
  }
  return all;
}

export function activePlayers(state: GameState): PlayerId[] {
  return state.active;
}

export function onDeck(state: GameState): PlayerId[] {
  return state.onDeck;
}

export function holderOf(state: GameState, giftId: GiftId): PlayerId | undefined {
  return state.gifts.find((g) => g.id === giftId)?.holderId ?? undefined;
}

/** Turns so far: equals the number of Gifts opened. */
export function turnCount(state: GameState): number {
  return state.gifts.length;
}

/** Picks so far: every Gift opened plus every Steal. */
export function pickCount(state: GameState): number {
  return state.picks;
}

export function isFrozen(state: GameState, giftId: GiftId): boolean {
  const gift = state.gifts.find((g) => g.id === giftId);
  return gift !== undefined && gift.steals >= state.settings.maxSteals;
}

export function stealCount(state: GameState, giftId: GiftId): number {
  return state.gifts.find((g) => g.id === giftId)?.steals ?? 0;
}

/** Gifts back on the table during the Final Round, free to take without a Steal. */
export function returnedGifts(state: GameState): GiftId[] {
  return state.gifts.filter((g) => g.holderId === null).map((g) => g.id);
}

export function leftoverGiftCount(state: GameState): number {
  return state.leftoverGifts;
}

export function phase(state: GameState): Phase {
  return state.phase;
}

export function roster(state: GameState): { id: PlayerId; name: string }[] {
  return state.players.map((p) => ({ id: p.id, name: p.name }));
}

/**
 * What a Gift is called: its name, or for one opened without a name (to keep up with a fast party, named later)
 * "Ann's gift", by who opened it, whoever holds it now.
 */
function giftLabel(state: GameState, giftId: GiftId): string {
  const i = state.gifts.findIndex((g) => g.id === giftId);
  const gift = state.gifts[i];
  if (gift?.name) return gift.name;
  const opener = state.players.find((p) => p.id === gift?.openedBy)?.name;
  return opener ? `${opener}'s gift` : `Gift ${i + 1}`;
}

/** Opened Gifts in the order opened. A null holder is a Returned Gift; `named` is false until someone names it. */
export function gifts(
  state: GameState,
): { id: GiftId; name: string; named: boolean; description: string; holderId: PlayerId | null; steals: number; frozen: boolean }[] {
  return state.gifts.map((g) => ({
    id: g.id,
    name: giftLabel(state, g.id),
    named: g.name !== "",
    description: g.description,
    holderId: g.holderId,
    steals: g.steals,
    frozen: isFrozen(state, g.id),
  }));
}

/**
 * Everything a Host can choose when creating a Game: its two rules plus how it's run. A Host may save their own set
 * and start every Game with it; a saved set is kept whole, so a later change to the recommendations never changes a
 * Host's Games without them knowing.
 */
export interface GameOptions extends GameSettings {
  /** The countdown each Turn shows, as a nudge; 0 for none. Nobody is skipped when it runs out. */
  turnSeconds: number;
  /** Who adds the Players: the Host and Co-hosts only ("host"), or people themselves from their phones too ("self"). */
  rosterMode: "host" | "self";
  /** A name someone picks for themselves waits for a Host or Co-host to approve it. */
  approveNames: boolean;
  /** Posts appear at once ("open"), wait for a Host ("approval"), or nobody can post ("paused"). */
  moderation: "open" | "approval" | "paused";
}

/** What a Host gets with "Use recommended settings". */
export const RECOMMENDED_OPTIONS: Readonly<GameOptions> = Object.freeze({
  activeSlots: 1,
  maxSteals: 3,
  turnSeconds: 60,
  rosterMode: "host",
  approveNames: false,
  moderation: "open",
});

/** The options, in the order they're shown and counted. */
export const OPTION_NAMES = ["activeSlots", "maxSteals", "turnSeconds", "rosterMode", "approveNames", "moderation"] as const satisfies readonly (keyof GameOptions)[];
