import { randomBytes, randomInt } from "node:crypto";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { asc, eq } from "drizzle-orm";
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
  type Event,
  type GameSettings,
  type GameState,
} from "@elephant/rules";
import { Server as SocketServer } from "socket.io";
import type { z } from "zod";
import { gameEvents, games, openDb } from "./db.js";
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
  /** Rebuilt Games, so a Game's log is replayed only once per server start. `seq` counts its logged events. */
  const cache = new Map<string, { state: GameState; seq: number }>();

  function load(id: string): { state: GameState; seq: number } | undefined {
    const cached = cache.get(id);
    if (cached) return cached;
    const row = db.select().from(games).where(eq(games.id, id)).get();
    if (!row) return undefined;
    const log = db.select().from(gameEvents).where(eq(gameEvents.gameId, id)).orderBy(asc(gameEvents.seq)).all();
    // Replaying the log never draws: every Draw was logged as a PlayerDrawn event (ADR-0001).
    const state = log.map((e) => JSON.parse(e.event) as Event).reduce(evolve, newGame(JSON.parse(row.settings) as GameSettings));
    const game = { state, seq: log.length };
    cache.set(id, game);
    return game;
  }

  /** Set once listening: every screen watching a Game sits in a room named by the Game's id. */
  let io: SocketServer | undefined;

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
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);
    return c.json(view(id, game.state));
  });

  app.post("/api/games/:id/commands", async (c) => {
    const id = c.req.param("id");
    const body = await parseBody(c, command);
    if (!body.ok) return body.res;
    const game = load(id);
    if (!game) return c.json({ error: "Game not found" }, 404);

    // Everything from here to the cache update is synchronous, so two commands never interleave.
    const result = decide(game.state, body.data, draw);
    if (!Array.isArray(result)) return c.json(result, 409);
    const now = new Date();
    // One transaction: a command's events are all logged, or none are.
    db.transaction((tx) => {
      result.forEach((event, i) => {
        tx.insert(gameEvents).values({ gameId: id, seq: game.seq + i + 1, event: JSON.stringify(event), createdAt: now }).run();
      });
    });
    const next = { state: result.reduce(evolve, game.state), seq: game.seq + result.length };
    cache.set(id, next);
    const shown = view(id, next.state);
    io?.to(id).emit("game", shown);
    return c.json(shown);
  });

  /** Serves HTTP and live updates on one port (0 picks a free one). Screens only listen; moves go over HTTP. */
  function listen(port: number): Promise<{ port: number; close: () => Promise<void> }> {
    return new Promise((resolve) => {
      const http = serve({ fetch: app.fetch, port }, (info: AddressInfo) => {
        resolve({ port: info.port, close: () => new Promise((done) => sockets.close(() => done())) });
      });
      const sockets = new SocketServer(http);
      io = sockets;

      sockets.use((socket, next) => {
        const gameId: unknown = socket.handshake.auth["gameId"];
        if (typeof gameId !== "string" || !load(gameId)) return next(new Error("Game not found"));
        next();
      });
      // On every connection, including a phone waking and reconnecting, send the whole Game.
      sockets.on("connection", (socket) => {
        const gameId = socket.handshake.auth["gameId"] as string;
        void socket.join(gameId);
        socket.emit("game", view(gameId, load(gameId)!.state));
      });
    });
  }

  return { app, listen };
}
