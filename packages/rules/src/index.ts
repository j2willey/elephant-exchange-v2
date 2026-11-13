export type PlayerId = string;
export type GiftId = string;

export interface GameSettings {
  /** How many Players may take Turns at the same time. */
  activeSlots: number;
}

/** Picks one Player from the candidates. The server passes real randomness; tests pass a script. */
export type DrawFn = (candidates: PlayerId[]) => PlayerId;

export type Command =
  | { type: "AddPlayer"; playerId: PlayerId; name: string }
  | { type: "StartGame" }
  | { type: "OpenGift"; playerId: PlayerId; giftId: GiftId; name: string };

/** What actually happened; these are what the Game's log stores. */
export type Event =
  | { type: "PlayerAdded"; playerId: PlayerId; name: string }
  | { type: "GameStarted" }
  | { type: "PlayerDrawn"; playerId: PlayerId }
  | { type: "GiftOpened"; playerId: PlayerId; giftId: GiftId; name: string };

export interface RuleError {
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
}

export interface GameState {
  settings: GameSettings;
  players: Player[];
  /** Drawn Players in order, not yet finished: the first is active, the rest are On Deck. */
  drawn: PlayerId[];
  gifts: Gift[];
  picks: number;
}

export function newGame(settings: GameSettings): GameState {
  return { settings, players: [], drawn: [], gifts: [], picks: 0 };
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
  }
}

export function evolve(state: GameState, event: Event): GameState {
  switch (event.type) {
    case "PlayerAdded":
      return { ...state, players: [...state.players, { id: event.playerId, name: event.name }] };
    case "GameStarted":
      return state;
    case "PlayerDrawn":
      return { ...state, drawn: [...state.drawn, event.playerId] };
    case "GiftOpened":
      return {
        ...state,
        drawn: state.drawn.filter((id) => id !== event.playerId),
        gifts: [...state.gifts, { id: event.giftId, name: event.name, holderId: event.playerId }],
        picks: state.picks + 1,
      };
  }
}

/** Players who have neither been drawn nor received a Gift: the pool for the next Draw. */
function notYetCalled(state: GameState): PlayerId[] {
  return state.players
    .map((p) => p.id)
    .filter((id) => !state.drawn.includes(id) && !state.gifts.some((g) => g.holderId === id));
}

export function activePlayers(state: GameState): PlayerId[] {
  return state.drawn.slice(0, 1);
}

export function onDeck(state: GameState): PlayerId[] {
  return state.drawn.slice(1);
}

/** Turns so far: equals the number of Gifts opened. */
export function turnCount(state: GameState): number {
  return state.gifts.length;
}

/** Picks so far: every Gift opened plus every Steal. */
export function pickCount(state: GameState): number {
  return state.picks;
}
