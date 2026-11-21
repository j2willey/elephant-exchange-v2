import { afterEach, describe, expect, it } from "vitest";
import { io } from "socket.io-client";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

// So that Games could one day be spread over several servers, with Caddy sending each request to the server that
// holds its Game (docs/scale-plan.md, "One server per Game"): a Game's id names its server, and the live
// connection carries the id where Caddy can see it, in its URL.
describe("A Game's server tag", () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) await fn();
  });

  async function started(options: { serverTag?: string } = {}) {
    const { sent, mailer } = capturingMailer();
    const server = createServer({ dbPath: ":memory:", mailer, ...options });
    const { port, close } = await server.listen(0);
    cleanups.push(close);
    const base = `http://localhost:${port}`;
    const host = await signIn(server.app, sent, "host@example.com");
    const create = async () =>
      ((await (await fetch(`${base}/api/games`, post({ settings: { activeSlots: 1, maxSteals: 3 } }, host))).json()) as { id: string }).id;
    return { base, create };
  }

  /** Connects a screen the given way and resolves with the Game it was sent, or the error. */
  function connect(base: string, how: { auth?: object; query?: Record<string, string> }) {
    const screen = io(base, { ...how, transports: ["websocket"], reconnection: false });
    cleanups.push(() => void screen.close());
    return new Promise<{ game?: { id: string }; error?: string }>((done) => {
      screen.once("game", (game: { id: string }) => done({ game }));
      screen.once("connect_error", (err) => done({ error: err.message }));
    });
  }

  it("starts every new Game's id: 'a.' on the first server", async () => {
    const { create } = await started();

    const id = await create();

    expect(id).toMatch(/^a\.[A-Za-z0-9_-]{22}$/);
  });

  it("is the server's own when it's given one", async () => {
    const { create } = await started({ serverTag: "b" });

    expect(await create()).toMatch(/^b\./);
  });

  it("refuses a tag that isn't a few lowercase letters or digits", () => {
    expect(() => createServer({ dbPath: ":memory:", serverTag: "B/1" })).toThrow(/serverTag/);
  });

  it("lets a screen name its Game in the connection's URL", async () => {
    const { base, create } = await started();
    const id = await create();

    expect((await connect(base, { query: { game: id } })).game?.id).toBe(id);
  });

  it("still lets a page loaded before the change name it the old way", async () => {
    const { base, create } = await started();
    const id = await create();

    expect((await connect(base, { auth: { gameId: id } })).game?.id).toBe(id);
  });

  it("still turns away a Game that isn't there", async () => {
    const { base } = await started();

    expect(await connect(base, { query: { game: "a.nope" } })).toEqual({ error: "Game not found" });
  });
});
