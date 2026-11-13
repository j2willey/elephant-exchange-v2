export type PlayerId = string;

export interface GameSettings {
  /** How many Players may take Turns at the same time. */
  activeSlots: number;
}

/** Picks one Player from the candidates. The server passes real randomness; tests pass a script. */
export type DrawFn = (candidates: PlayerId[]) => PlayerId;

export type Command =
  | { type: "AddPlayer"; playerId: PlayerId; name: string }
  | { type: "StartGame" };

/** What actually happened; these are what the Game's log stores. */
export type Event =
  | { type: "PlayerAdded"; playerId: PlayerId; name: string }
  | { type: "GameStarted" }
  | { type: "PlayerDrawn"; playerId: PlayerId };

export interface RuleError {
  message: string;
}

interface Player {
  id: PlayerId;
  name: string;
}

export interface GameState {
  settings: GameSettings;
  players: Player[];
  /** Drawn Players in order, not yet finished: the first is active, the rest are On Deck. */
  drawn: PlayerId[];
}

export function newGame(settings: GameSettings): GameState {
  return { settings, players: [], drawn: [] };
}

export function decide(state: GameState, command: Command, draw: DrawFn): Event[] | RuleError {
  switch (command.type) {
    case "AddPlayer":
      return [{ type: "PlayerAdded", playerId: command.playerId, name: command.name }];
    case "StartGame": {
      const events: Event[] = [{ type: "GameStarted" }];
      const pool = state.players.map((p) => p.id);
      for (let i = 0; i < 2 && pool.length > 0; i++) {
        const playerId = draw(pool);
        pool.splice(pool.indexOf(playerId), 1);
        events.push({ type: "PlayerDrawn", playerId });
      }
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
  }
}

export function activePlayers(state: GameState): PlayerId[] {
  return state.drawn.slice(0, 1);
}

export function onDeck(state: GameState): PlayerId[] {
  return state.drawn.slice(1);
}
