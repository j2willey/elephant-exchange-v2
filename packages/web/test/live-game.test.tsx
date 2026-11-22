import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { clock, drawInOrder, openApp, startServer } from "./harness.js";

describe("A Game kept current on a screen", () => {
  it.each([
    ["a moment after", true],
    ["in the same millisecond as", false],
  ])("isn't taken back by its first load answering late, when a setting changed %s it was sent", async (_when, moment) => {
    const server = await startServer({ draw: drawInOrder });
    const host = await server.signedIn("host@example.com");
    const id = await host.createGame({ name: "Party", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3, rosterMode: "host" } });

    // The page's first load is answered at once, but its answer only reaches the page when let through.
    let letThrough = () => {};
    const held = new Promise<void>((resolve) => (letThrough = resolve));
    const load = host.game.bind(host);
    host.game = (gameId) => load(gameId).then(async (copy) => (await held, copy));
    // And note when the live connection has brought its first copy.
    let live = () => {};
    const connected = new Promise<void>((resolve) => (live = resolve));
    const watch = host.watch.bind(host);
    host.watch = (gameId, onGame, ...rest) => watch(gameId, (g) => (onGame(g), live()), ...rest);

    openApp(host, `/games/${id}`);
    await act(() => connected);
    await screen.findByRole("heading", { name: "Party" });

    // A moment later a setting changes (which doesn't raise the version, as a Pick does), and the live copy shows it.
    if (moment) clock.advance(1);
    await host.setGameOptions(id, { name: "OA Holiday Party" });
    await screen.findByRole("heading", { name: "OA Holiday Party" });

    // Now the first load's answer, from before the change, arrives.
    await act(async () => {
      letThrough();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByRole("heading", { name: "OA Holiday Party" })).toBeInTheDocument();
  });
});
