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

  it("names the Game in a banner across the top", async () => {
    const { origin, signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const id = await host.createGame({ activeSlots: 1, maxSteals: 3 }, "OA Holiday Party");
    openApp(browser(origin), `/games/${id}/screen`);

    expect(await screen.findByRole("banner")).toHaveTextContent(/oa holiday party/i);
  });

  it("shows each Gift's holder and its Steals against the limit, under column headings", async () => {
    const { origin, host, id } = await startedGame();
    await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });
    await host.command(id, { type: "Steal", playerId: "bob", giftId: "g1" });
    openApp(browser(origin), `/games/${id}/screen`);

    const socks = await screen.findByRole("listitem", { name: /socks/i });
    expect(within(socks).getByText("Bob")).toBeInTheDocument();
    expect(within(socks).getByText(/1\/3 steals/i)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /gift board/i })).toHaveTextContent(/^gift\s*holder\s*status/i);
  });

  it("warns when a Gift has one Steal left before it's Frozen", async () => {
    const { origin, host, id } = await startedGame();
    await host.command(id, { type: "ChangeSettings", settings: { maxSteals: 2 } });
    await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });
    openApp(browser(origin), `/games/${id}/screen`);
    expect(within(await screen.findByRole("listitem", { name: /socks/i })).getByText(/0\/2 steals/i)).not.toHaveAttribute("data-state", "last");

    await host.command(id, { type: "Steal", playerId: "bob", giftId: "g1" });

    await waitFor(() => expect(within(screen.getByRole("listitem", { name: /socks/i })).getByText(/1\/2 steals/i)).toHaveAttribute("data-state", "last"));
  });

  it("lists the Gifts still in play first, most stolen at the top, and Frozen ones last", async () => {
    const server = await startServer({ draw: drawInOrder });
    const host = await server.signedIn("host@example.com");
    const id = await host.createGame({ activeSlots: 1, maxSteals: 2 });
    for (const name of ["Ann", "Bob", "Cat", "Dan", "Eve"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
    await host.command(id, { type: "StartGame" });
    await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });
    await host.command(id, { type: "Steal", playerId: "bob", giftId: "g1" });
    await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g2", name: "Mug" });
    await host.command(id, { type: "Steal", playerId: "cat", giftId: "g1" }); // Socks' second Steal: Frozen
    await host.command(id, { type: "OpenGift", playerId: "bob", giftId: "g3", name: "Candle" });
    await host.command(id, { type: "Steal", playerId: "dan", giftId: "g2" });
    openApp(browser(server.origin), `/games/${id}/screen`);

    await screen.findByRole("listitem", { name: /socks/i });
    const order = within(screen.getByRole("list", { name: /gifts/i }))
      .getAllByRole("listitem")
      .map((li) => li.getAttribute("aria-label"));
    expect(order).toEqual(["Mug", "Candle", "Socks"]);
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

