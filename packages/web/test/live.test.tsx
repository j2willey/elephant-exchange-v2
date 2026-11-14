import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { browser, drawInOrder, openApp, startServer } from "./harness.js";

/** A Game with Ann, Bob and Cat, started, and the Host's browser to run it from. */
async function startedGame() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ activeSlots: 1, maxSteals: 3 });
  for (const name of ["Ann", "Bob", "Cat"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
  await host.command(id, { type: "StartGame" });
  return { ...server, host, id };
}

const upNowIs = (name: string) =>
  waitFor(() => expect(screen.getByText(/up now/i).closest("section")).toHaveTextContent(new RegExp(`up now\\W*${name}`, "i")));

describe("The watch screen", () => {
  it("shows who is up and on deck, and keeps up as the Host plays", async () => {
    const { origin, host, id } = await startedGame();
    openApp(browser(origin), `/games/${id}/screen`);
    await upNowIs("Ann");
    expect(screen.getByText(/on deck/i).closest("section")).toHaveTextContent(/on deck\W*bob/i);

    await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });

    await upNowIs("Bob");
    expect(await screen.findByRole("listitem", { name: /socks/i })).toHaveTextContent(/socks.*ann/i);
  });

  it("shows Steals and Frozen Gifts as they happen", async () => {
    const { origin, host, id } = await startedGame();
    await host.command(id, { type: "ChangeSettings", settings: { maxSteals: 1 } });
    await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });
    openApp(browser(origin), `/games/${id}/screen`);
    await screen.findByRole("listitem", { name: /socks/i });

    await host.command(id, { type: "Steal", playerId: "bob", giftId: "g1" });

    await waitFor(() => expect(screen.getByRole("listitem", { name: /socks/i })).toHaveTextContent(/socks.*bob.*frozen/i));
  });

  it("shows a QR code and the link for joining the Game", async () => {
    const { origin, id } = await startedGame();
    openApp(browser(origin), `/games/${id}/screen`);

    const join = await screen.findByRole("region", { name: /join/i });
    expect(within(join).getByRole("img", { name: /qr code to join/i })).toBeInTheDocument();
    expect(join).toHaveTextContent(new RegExp(`/games/${id}`));
  });

  it("before the start, says it's waiting and counts the Players", async () => {
    const { origin, signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const id = await host.createGame({ activeSlots: 1, maxSteals: 3 });
    openApp(browser(origin), `/games/${id}/screen`);
    expect(await screen.findByText(/waiting for the host to start/i)).toBeInTheDocument();

    await host.command(id, { type: "AddPlayer", playerId: "ann", name: "Ann" });
    await host.command(id, { type: "AddPlayer", playerId: "bob", name: "Bob" });

    expect(await screen.findByText(/2 players/i)).toBeInTheDocument();
  });

  it("says so for a Game that doesn't exist", async () => {
    const { origin } = await startServer();
    openApp(browser(origin), "/games/nope/screen");
    expect(await screen.findByText(/no game at this link/i)).toBeInTheDocument();
  });
});

describe("The Host's page", () => {
  it("shows a Co-host's moves from another phone as they happen", async () => {
    const { host, id, signedIn } = await startedGame();
    await host.addCohost(id, "bob@example.com");
    const cohost = await signedIn("bob@example.com");
    openApp(host, `/games/${id}`);
    await upNowIs("Ann");

    await cohost.command(id, { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });

    await upNowIs("Bob");
    expect(await screen.findByRole("listitem", { name: /socks/i })).toBeInTheDocument();
  });
});

