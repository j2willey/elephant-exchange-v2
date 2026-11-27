import { describe, expect, it } from "vitest";
import { createRunner } from "../src/demo-scripts/runner.js";
import { SCRIPTS } from "../src/demo-scripts/scripts.js";
import { startServer } from "./harness.js";

const script = SCRIPTS["happy-path"]!;

/** The guided tour's runner plays a script on a real demo Game through the real server (no page). */
describe("The guided tour's runner", () => {
  it("plays the happy path from start to finish on the server, every step's expect holding", async () => {
    const { signedIn } = await startServer(); // the server's own Draw is random: the script's Draws must win
    const api = await signedIn("host@example.com");
    const drift: string[] = [];
    const runner = createRunner(api, script, { onDrift: (step, d) => drift.push(`${step}: ${d.join("; ")}`) });

    await runner.show(0);
    while (runner.step() < script.steps.length - 1) await runner.next();

    expect(drift).toEqual([]);
    const game = (await api.game(runner.gameId()!))!;
    expect(game.phase).toBe("ended");
    const holder = (key: string) => game.players.find((p) => p.id === game.gifts.find((g) => g.id === runner.giftId(key))?.holderId)?.name;
    expect(holder("blanket")).toBe("Ann");
    expect(holder("karaoke")).toBe("Ben");
    expect(game.screen).toBe("highlights");
    expect((await api.posts(runner.gameId()!)).length).toBeGreaterThan(5);
  });

  it("counts as one demo started, however often Back and Restart build a fresh Game", async () => {
    const { signedIn } = await startServer({ adminEmails: ["boss@example.org"] });
    const api = await signedIn("host@example.com");
    const runner = createRunner(api, script);
    await runner.show(3);
    await runner.show(1); // Back
    await runner.show(0); // Restart

    const stats = await (await signedIn("boss@example.org")).adminStats();
    expect(stats !== "notFound" && stats.insights.demosStarted).toEqual([{ day: expect.any(String), self: 0, guided: 1 }]);
  });

  it("goes back by building a fresh Game up to that step, and deletes the one before", async () => {
    const { signedIn } = await startServer();
    const api = await signedIn("host@example.com");
    const runner = createRunner(api, script);
    const k = script.steps.findIndex((s) => s.id === "s12-ann-victim");

    await runner.show(k);
    const first = runner.gameId()!;
    const holderOfBlanket = async () => {
      const game = (await api.game(runner.gameId()!))!;
      return game.players.find((p) => p.id === game.gifts.find((g) => g.id === runner.giftId("blanket"))?.holderId)?.name;
    };
    expect(await holderOfBlanket()).toBe("Cat");

    await runner.show(k - 1); // "Cat steals": a "next" step, so the steal hasn't happened yet
    expect(runner.gameId()).not.toBe(first);
    expect(await holderOfBlanket()).toBe("Ann");
    await expect.poll(() => api.game(first)).toBeUndefined();

    await runner.dispose();
  });
});
