import { afterEach, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import type { DrawFn } from "@elephant/rules";
import { createServer } from "../src/server.js";

const post = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

function scriptedDraw(order: string[]): DrawFn {
  const queue = [...order];
  return (candidates) => {
    const next = queue.shift();
    if (!next || !candidates.includes(next)) throw new Error(`script can't draw ${next} from ${candidates.join(",")}`);
    return next;
  };
}

type View = { id: string; phase: string; players: { id: string }[]; active: string[] };

/** Resolves with the next Game update this screen receives. */
const nextGame = (socket: Socket) => new Promise<View>((resolve) => socket.once("game", resolve));

describe("Live updates", () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) await fn();
  });

  async function start(draw?: DrawFn) {
    const server = createServer({ dbPath: ":memory:", ...(draw ? { draw } : {}) });
    const { port, close } = await server.listen(0);
    cleanups.push(close);
    const base = `http://localhost:${port}`;
    const http = (path: string, init?: RequestInit) => fetch(base + path, init);
    const connect = (gameId: string) => {
      const socket = io(base, { auth: { gameId }, transports: ["websocket"], reconnection: false });
      cleanups.push(() => void socket.close());
      return socket;
    };
    return { http, connect };
  }

  it("shows a screen the whole Game as soon as it connects", async () => {
    const { http, connect } = await start();
    const { id } = (await (await http("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 } }))).json()) as { id: string };
    await http(`/api/games/${id}/commands`, post({ type: "AddPlayer", playerId: "ann", name: "Ann" }));

    const game = await nextGame(connect(id));

    expect(game).toMatchObject({ id, phase: "setup", players: [{ id: "ann" }] });
  });

  it("sends every connected screen the new Game after each command", async () => {
    const { http, connect } = await start(scriptedDraw(["ann", "bob"]));
    const { id } = (await (await http("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 } }))).json()) as { id: string };
    await http(`/api/games/${id}/commands`, post({ type: "AddPlayer", playerId: "ann", name: "Ann" }));
    await http(`/api/games/${id}/commands`, post({ type: "AddPlayer", playerId: "bob", name: "Bob" }));
    const host = connect(id);
    const guest = connect(id);
    await Promise.all([nextGame(host), nextGame(guest)]); // the initial Game

    const updates = Promise.all([nextGame(host), nextGame(guest)]);
    await http(`/api/games/${id}/commands`, post({ type: "StartGame" }));

    for (const game of await updates) expect(game).toMatchObject({ phase: "playing", active: ["ann"] });
  });

  it("sends nothing to screens watching a different Game", async () => {
    const { http, connect } = await start(scriptedDraw(["ann"]));
    const create = async () => ((await (await http("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 } }))).json()) as { id: string }).id;
    const watched = await create();
    const other = await create();
    const screen = connect(watched);
    await nextGame(screen);
    const received: View[] = [];
    screen.on("game", (g: View) => received.push(g));

    await http(`/api/games/${other}/commands`, post({ type: "AddPlayer", playerId: "ann", name: "Ann" }));
    // A command to the watched Game afterwards proves the screen was listening the whole time.
    const marker = nextGame(screen);
    await http(`/api/games/${watched}/commands`, post({ type: "AddPlayer", playerId: "bob", name: "Bob" }));
    await marker;

    expect(received.map((g) => g.id)).toEqual([watched]);
  });

  it("turns away a screen asking for a Game that doesn't exist", async () => {
    const { connect } = await start();
    const err = await new Promise<Error>((resolve) => connect("nope").once("connect_error", resolve));
    expect(err.message).toBe("Game not found");
  });
});
