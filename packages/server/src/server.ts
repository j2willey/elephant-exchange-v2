import { randomBytes, randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import {
  activePlayers,
  decide,
  evolve,
  gifts,
  newGame,
  onDeck,
  phase,
  roster,
  type DrawFn,
  type GameSettings,
  type GameState,
} from "@elephant/rules";
import type { z } from "zod";
import { games, openDb } from "./db.js";
import { command, createGameBody } from "./schemas.js";

export interface ServerOptions {
  /** SQLite file path, or ":memory:" for tests. */
  dbPath: string;
  /** Picks who is called up next. Defaults to cryptographic randomness; tests pass a script. */
  draw?: DrawFn;
}

const randomDraw: DrawFn = (candidates) => candidates[randomInt(candidates.length)]!;

/** What screens are shown about a Game: answers from the rules module, never its internal state. */
function view(id: string, state: GameState) {
  return {
    id,
    phase: phase(state),
    settings: state.settings,
    players: roster(state),
    active: activePlayers(state),
    onDeck: onDeck(state),
    gifts: gifts(state),
  };
}

/** Reads and checks a JSON body; on failure, the 400 response to send instead. */
async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  const raw: unknown = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, res: c.json({ error: "Invalid request", issues: parsed.error.issues }, 400) };
}

export function createServer({ dbPath, draw = randomDraw }: ServerOptions) {
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
    const body = await parseBody(c, createGameBody);
    if (!body.ok) return body.res;
    // 16 random bytes: unguessable, so a Game can't be found without its link or QR code.
    const id = randomBytes(16).toString("base64url");
    db.insert(games).values({ id, settings: JSON.stringify(body.data.settings), createdAt: new Date() }).run();
    return c.json({ id }, 201);
  });

  app.get("/api/games/:id", (c) => {
    const id = c.req.param("id");
    const state = load(id);
    if (!state) return c.json({ error: "Game not found" }, 404);
    return c.json(view(id, state));
  });

  app.post("/api/games/:id/commands", async (c) => {
    const id = c.req.param("id");
    const state = load(id);
    if (!state) return c.json({ error: "Game not found" }, 404);
    const body = await parseBody(c, command);
    if (!body.ok) return body.res;

    // Everything from here to the cache update is synchronous, so two commands never interleave.
    const result = decide(state, body.data, draw);
    if (!Array.isArray(result)) return c.json(result, 409);
    const next = result.reduce(evolve, state);
    cache.set(id, next);
    return c.json(view(id, next));
  });

  return { app };
}
