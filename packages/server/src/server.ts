import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { newGame, phase, roster, type GameSettings, type GameState } from "@elephant/rules";
import { games, openDb } from "./db.js";

export interface ServerOptions {
  /** SQLite file path, or ":memory:" for tests. */
  dbPath: string;
}

/** What screens are shown about a Game: answers from the rules module, never its internal state. */
function view(id: string, state: GameState) {
  return {
    id,
    phase: phase(state),
    settings: state.settings,
    players: roster(state),
  };
}

export function createServer({ dbPath }: ServerOptions) {
  const db = openDb(dbPath);
  /** Rebuilt Game states, so a Game's log is replayed only once per server start. */
  const cache = new Map<string, GameState>();

  function load(id: string): GameState | undefined {
    const cached = cache.get(id);
    if (cached) return cached;
    const row = db.select().from(games).where(eq(games.id, id)).get();
    if (!row) return undefined;
    const state = newGame(JSON.parse(row.settings) as GameSettings);
    cache.set(id, state);
    return state;
  }

  const app = new Hono();

  app.post("/api/games", async (c) => {
    const { settings } = await c.req.json<{ settings: GameSettings }>();
    // 16 random bytes: unguessable, so a Game can't be found without its link or QR code.
    const id = randomBytes(16).toString("base64url");
    db.insert(games).values({ id, settings: JSON.stringify(settings), createdAt: new Date() }).run();
    return c.json({ id }, 201);
  });

  app.get("/api/games/:id", (c) => {
    const id = c.req.param("id");
    const state = load(id);
    if (!state) return c.json({ error: "Game not found" }, 404);
    return c.json(view(id, state));
  });

  return { app };
}
