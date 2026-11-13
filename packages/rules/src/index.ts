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
  | { type: "OpenGift"; playerId: PlayerId; giftId: GiftId; name: string }
  | { type: "Steal"; playerId: PlayerId; giftId: GiftId }
  | { type: "ChangeSettings"; settings: Partial<GameSettings> };

/** What actually happened; these are what the Game's log stores. */
export type Event =
  | { type: "PlayerAdded"; playerId: PlayerId; name: string }
  | { type: "GameStarted" }
  | { type: "PlayerDrawn"; playerId: PlayerId }
  | { type: "GiftOpened"; playerId: PlayerId; giftId: GiftId; name: string }
  | { type: "GiftStolen"; playerId: PlayerId; giftId: GiftId; fromPlayerId: PlayerId }
  | { type: "SettingsChanged"; settings: Partial<GameSettings> };

export type RuleErrorCode = "NotActive" | "GiftNotOpened" | "GiftFrozen" | "NoTakeBacks";

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
  holderId: PlayerId;
  steals: number;
}

export interface GameState {
  settings: GameSettings;
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
}

export function newGame(settings: GameSettings): GameState {
  return { settings, players: [], called: [], active: [], onDeck: [], takenFrom: {}, gifts: [], picks: 0 };
}

export function decide(state: GameState, command: Command, draw: DrawFn): Event[] | RuleError {
  if ((command.type === "OpenGift" || command.type === "Steal") && !state.active.includes(command.playerId)) {
    return { code: "NotActive", message: "It isn't this Player's Turn" };
  }
  switch (command.type) {
    case "AddPlayer":
      return [{ type: "PlayerAdded", playerId: command.playerId, name: command.name }];
    case "StartGame":
      return withDraws(state, [{ type: "GameStarted" }], draw);
    case "OpenGift":
      return withDraws(
        state,
        [{ type: "GiftOpened", playerId: command.playerId, giftId: command.giftId, name: command.name }],
        draw,
      );
    case "Steal": {
      const gift = state.gifts.find((g) => g.id === command.giftId);
      if (!gift) return { code: "GiftNotOpened", message: `No opened Gift ${command.giftId}` };
      if (gift.steals >= state.settings.maxSteals) {
        return { code: "GiftFrozen", message: `${gift.name} is Frozen and can't be stolen` };
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
  }
}

export function evolve(state: GameState, event: Event): GameState {
  switch (event.type) {
    case "PlayerAdded":
      return { ...state, players: [...state.players, { id: event.playerId, name: event.name }] };
    case "GameStarted":
      return state;
    case "PlayerDrawn":
      return moveUp({
        ...state,
        called: [...state.called, event.playerId],
        onDeck: [...state.onDeck, event.playerId],
      });
    case "GiftOpened":
      return moveUp({
        ...state,
        active: state.active.filter((id) => id !== event.playerId),
        takenFrom: without(state.takenFrom, event.playerId),
        gifts: [...state.gifts, { id: event.giftId, name: event.name, holderId: event.playerId, steals: 0 }],
        picks: state.picks + 1,
      });
    case "GiftStolen":
      return {
        ...state,
        // The stealer is done; the Victim takes their place, whatever the slot limit.
        active: [...state.active.filter((id) => id !== event.playerId), event.fromPlayerId],
        takenFrom: { ...without(state.takenFrom, event.playerId), [event.fromPlayerId]: event.giftId },
        gifts: state.gifts.map((g) => (g.id === event.giftId ? { ...g, holderId: event.playerId, steals: g.steals + 1 } : g)),
        picks: state.picks + 1,
      };
    case "SettingsChanged":
      return moveUp({ ...state, settings: { ...state.settings, ...event.settings } });
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
  while (active.length < state.settings.activeSlots && onDeck.length > 0) {
    active.push(onDeck.shift()!);
  }
  return { ...state, active, onDeck };
}

/**
 * Appends Draws after the given events until the active slots are full and the On Deck line
 * holds as many Players as there are slots (or nobody is left to draw).
 */
function withDraws(state: GameState, events: Event[], draw: DrawFn): Event[] {
  let next = events.reduce(evolve, state);
  const all = [...events];
  const slots = next.settings.activeSlots;
  let pool = notYetCalled(next);
  while ((next.active.length < slots || next.onDeck.length < slots) && pool.length > 0) {
    const drawn: Event = { type: "PlayerDrawn", playerId: draw(pool) };
    all.push(drawn);
    next = evolve(next, drawn);
    pool = notYetCalled(next);
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
  return state.gifts.find((g) => g.id === giftId)?.holderId;
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
