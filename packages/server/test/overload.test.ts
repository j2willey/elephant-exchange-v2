import { afterEach, describe, expect, it } from "vitest";
import { io } from "socket.io-client";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

describe("When the server is too busy for another party", () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) await fn();
  });

  it("turns a new Game away until there's room again, while a party already under way carries on", async () => {
    const { sent, mailer } = capturingMailer();
    const server = createServer({ dbPath: ":memory:", mailer, overload: { maxScreens: 2 } });
    const { port, close } = await server.listen(0);
    cleanups.push(close);
    const base = `http://localhost:${port}`;
    const host = await signIn(server.app, sent, "host@example.com");
    const create = () => fetch(`${base}/api/games`, post({ settings: { activeSlots: 1, maxSteals: 3 } }, host));
    const health = async () => (await (await fetch(`${base}/api/health`)).json()) as { ok: boolean; busy: boolean };

    const first = (await (await create()).json()) as { id: string };
    const screens = [0, 1].map(() => io(base, { auth: { gameId: first.id }, transports: ["websocket"], reconnection: false }));
    cleanups.push(() => screens.forEach((s) => s.close()));
    await Promise.all(screens.map((s) => new Promise((done) => s.once("game", done))));

    const refused = await create();
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: "busy" });
    expect(await health()).toEqual({ ok: true, busy: true }); // still healthy, so the uptime monitor doesn't page
    // The party under way still plays.
    expect((await fetch(`${base}/api/games/${first.id}/commands`, post({ type: "AddPlayer", playerId: "ann", name: "Ann" }, host))).status).toBe(200);

    screens[1]!.close();
    await expect.poll(async () => (await create()).status).toBe(201);
  });
});
