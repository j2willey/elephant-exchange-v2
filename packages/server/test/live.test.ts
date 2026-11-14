import { afterEach, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import type { DrawFn } from "@elephant/rules";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

type View = { id: string; phase: string; players: { id: string }[]; active: string[] };

/** Resolves with the next Game update this screen receives. */
const nextGame = (socket: Socket) => new Promise<View>((resolve) => socket.once("game", resolve));

describe("Live updates", () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) await fn();
  });

  /** A listening server with a signed-in Host; `create` makes a Game and `send` sends it a command, both over real HTTP. */
  async function start(draw?: DrawFn) {
    const { sent, mailer } = capturingMailer();
    const server = createServer({ dbPath: ":memory:", mailer, ...(draw ? { draw } : {}) });
    const { port, close } = await server.listen(0);
    cleanups.push(close);
    const base = `http://localhost:${port}`;
    const cookie = await signIn(server.app, sent, "host@example.com");
    const create = async () =>
      ((await (await fetch(`${base}/api/games`, post({ settings: { activeSlots: 1, maxSteals: 3 } }, cookie))).json()) as { id: string }).id;
    const send = (id: string, command: unknown) => fetch(`${base}/api/games/${id}/commands`, post(command, cookie));
    const connect = (gameId: string) => {
      const socket = io(base, { auth: { gameId }, transports: ["websocket"], reconnection: false });
      cleanups.push(() => void socket.close());
      return socket;
    };
    return { create, send, connect };
  }

  it("shows a screen the whole Game as soon as it connects", async () => {
    const { create, send, connect } = await start();
    const id = await create();
    await send(id, { type: "AddPlayer", playerId: "ann", name: "Ann" });

    const game = await nextGame(connect(id));

    expect(game).toMatchObject({ id, phase: "setup", players: [{ id: "ann" }] });
  });

  it("sends every connected screen the new Game after each command", async () => {
    const { create, send, connect } = await start((c) => (c.includes("ann") ? "ann" : c[0]!));
    const id = await create();
    await send(id, { type: "AddPlayer", playerId: "ann", name: "Ann" });
    await send(id, { type: "AddPlayer", playerId: "bob", name: "Bob" });
    const host = connect(id);
    const guest = connect(id);
    await Promise.all([nextGame(host), nextGame(guest)]); // the initial Game

    const updates = Promise.all([nextGame(host), nextGame(guest)]);
    await send(id, { type: "StartGame" });

    for (const game of await updates) expect(game).toMatchObject({ phase: "playing", active: ["ann"] });
  });

  it("sends nothing to screens watching a different Game", async () => {
    const { create, send, connect } = await start();
    const watched = await create();
    const other = await create();
    const screen = connect(watched);
    await nextGame(screen);
    const received: View[] = [];
    screen.on("game", (g: View) => received.push(g));

    await send(other, { type: "AddPlayer", playerId: "ann", name: "Ann" });
    // A command to the watched Game afterwards proves the screen was listening the whole time.
    const marker = nextGame(screen);
    await send(watched, { type: "AddPlayer", playerId: "bob", name: "Bob" });
    await marker;

    expect(received.map((g) => g.id)).toEqual([watched]);
  });

  it("turns away a screen asking for a Game that doesn't exist", async () => {
    const { connect } = await start();
    const err = await new Promise<Error>((resolve) => connect("nope").once("connect_error", resolve));
    expect(err.message).toBe("Game not found");
  });
});
