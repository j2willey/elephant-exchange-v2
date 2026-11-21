import { afterEach, describe, expect, it } from "vitest";
import { io } from "socket.io-client";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

const WAIT = 200;
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe("The Feed's change signal at a busy party", () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) await fn();
  });

  /** A listening server that gathers Feed signals over WAIT ms, a Game, and a screen counting the signals it gets. */
  async function party() {
    const { sent, mailer } = capturingMailer();
    const server = createServer({ dbPath: ":memory:", mailer, feedSignalMs: WAIT });
    const { port, close } = await server.listen(0);
    cleanups.push(close);
    const base = `http://localhost:${port}`;
    const host = await signIn(server.app, sent, "host@example.com");
    const { id } = (await (await fetch(`${base}/api/games`, post({ settings: { activeSlots: 1, maxSteals: 3 } }, host))).json()) as { id: string };
    const say = (text: string) => fetch(`${base}/api/games/${id}/posts`, post({ text, name: "Host" }, host));
    const feed = async () => (await (await fetch(`${base}/api/games/${id}/posts`)).json()) as { text: string }[];

    const screen = io(base, { auth: { gameId: id }, transports: ["websocket"], reconnection: false });
    cleanups.push(() => void screen.close());
    await new Promise((done) => screen.once("posts", done)); // the one every screen gets on connecting
    let signals = 0;
    screen.on("posts", () => signals++);
    return { say, feed, signals: () => signals };
  }

  it("goes out at once for a single change", async () => {
    const { say, signals } = await party();

    await say("First!");

    await expect.poll(signals, { timeout: WAIT / 2 }).toBe(1);
  });

  it("gathers a burst of changes into one more signal, so phones don't all fetch the Feed for each", async () => {
    const { say, feed, signals } = await party();

    for (const text of ["one", "two", "three", "four", "five"]) await say(text);
    expect(signals()).toBe(1); // the first, at once

    await expect.poll(signals, { timeout: WAIT * 3 }).toBe(2); // the rest, together
    await pause(WAIT * 2);
    expect(signals()).toBe(2);
    expect((await feed()).map((p) => p.text)).toEqual(["five", "four", "three", "two", "one"]); // none missed
  });

  it("is fresh again once things are quiet", async () => {
    const { say, signals } = await party();
    await say("one");
    await pause(WAIT * 3);
    const before = signals();

    await say("two");

    await expect.poll(signals, { timeout: WAIT / 2 }).toBe(before + 1);
  });
});
