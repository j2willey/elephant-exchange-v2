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

export type RuleErrorCode = "GiftNotOpened" | "GiftFrozen" | "NoTakeBacks";

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
  /** Drawn Players who have not yet taken their Turn, in order. */
  drawn: PlayerId[];
  /** Players whose Gift was stolen and who must act next, in order. */
  victims: PlayerId[];
  /** For each Victim, the Gift just taken from them, which they may not steal straight back. */
  takenFrom: Record<PlayerId, GiftId>;
  gifts: Gift[];
  picks: number;
}

export function newGame(settings: GameSettings): GameState {
  return { settings, players: [], called: [], drawn: [], victims: [], takenFrom: {}, gifts: [], picks: 0 };
}

export function decide(state: GameState, command: Command, draw: DrawFn): Event[] | RuleError {
  switch (command.type) {
    case "AddPlayer":
      return [{ type: "PlayerAdded", playerId: command.playerId, name: command.name }];
    case "StartGame": {
      const events: Event[] = [{ type: "GameStarted" }];
      const pool = notYetCalled(state);
      for (let i = 0; i < 2 && pool.length > 0; i++) {
        const playerId = draw(pool);
        pool.splice(pool.indexOf(playerId), 1);
        events.push({ type: "PlayerDrawn", playerId });
      }
      return events;
    }
    case "OpenGift": {
      const events: Event[] = [
        { type: "GiftOpened", playerId: command.playerId, giftId: command.giftId, name: command.name },
      ];
      const pool = notYetCalled(state);
      if (pool.length > 0) events.push({ type: "PlayerDrawn", playerId: draw(pool) });
      return events;
    }
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
      return [{ type: "SettingsChanged", settings: command.settings }];
  }
}

export function evolve(state: GameState, event: Event): GameState {
  switch (event.type) {
    case "PlayerAdded":
      return { ...state, players: [...state.players, { id: event.playerId, name: event.name }] };
    case "GameStarted":
      return state;
    case "PlayerDrawn":
      return {
        ...state,
        called: [...state.called, event.playerId],
        drawn: [...state.drawn, event.playerId],
      };
    case "GiftOpened":
      return {
        ...state,
        drawn: state.drawn.filter((id) => id !== event.playerId),
        victims: state.victims.filter((id) => id !== event.playerId),
        takenFrom: without(state.takenFrom, event.playerId),
        gifts: [...state.gifts, { id: event.giftId, name: event.name, holderId: event.playerId, steals: 0 }],
        picks: state.picks + 1,
      };
    case "GiftStolen":
      return {
        ...state,
        drawn: state.drawn.filter((id) => id !== event.playerId),
        victims: [...state.victims.filter((id) => id !== event.playerId), event.fromPlayerId],
        takenFrom: { ...without(state.takenFrom, event.playerId), [event.fromPlayerId]: event.giftId },
        gifts: state.gifts.map((g) => (g.id === event.giftId ? { ...g, holderId: event.playerId, steals: g.steals + 1 } : g)),
        picks: state.picks + 1,
      };
    case "SettingsChanged":
      return { ...state, settings: { ...state.settings, ...event.settings } };
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

/** Victims act first, then drawn Players in the order they were drawn. */
export function activePlayers(state: GameState): PlayerId[] {
  return [...state.victims, ...state.drawn].slice(0, 1);
}

export function onDeck(state: GameState): PlayerId[] {
  const active = activePlayers(state);
  return state.drawn.filter((id) => !active.includes(id));
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
