import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { browser, drawInOrder, openApp, startServer } from "./harness.js";

/** A Self sign-up Game under way: Ann opened Socks, so Bob is up. */
async function underway() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ name: "Troop swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3, rosterMode: "self" } });
  for (const name of ["Ann", "Bob", "Cat"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
  await host.command(id, { type: "StartGame" });
  await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "socks", name: "Socks" });
  return { ...server, host, id, user: userEvent.setup() };
}

const tab = (name: RegExp) => screen.findByRole("tab", { name });

describe("A guest's phone", () => {
  it("opens on the Gifts, with a tab bar for the rest and none of the Host's links", async () => {
    const { origin, id } = await underway();
    openApp(browser(origin), `/games/${id}`);

    expect(await tab(/gifts/i)).toHaveAttribute("aria-selected", "true");
    for (const name of [/^you$/i, /feed/i, /post/i]) expect(await tab(name)).toHaveAttribute("aria-selected", "false");
    expect(await screen.findByRole("listitem", { name: "Socks" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Troop swap" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /scoreboard|link for guests|settings/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("feed")).not.toBeInTheDocument();
  });

  it("keeps who's up and who's on deck in a bar at the top, on one row when 1 or 2 take a turn at once", async () => {
    const { origin, id } = await underway();
    openApp(browser(origin), `/games/${id}`);

    const bar = await screen.findByRole("status", { name: /who's up/i });
    // Ann opened her Gift, so it's Bob's turn.
    await waitFor(() => expect(bar).toHaveTextContent(/up now:\s*bob\s*·\s*on deck:\s*cat/i));
    expect(within(bar).getAllByRole("paragraph")).toHaveLength(1);
  });

  it("puts them on two rows, names separated by commas, when 3 or more take a turn at once", async () => {
    const server = await startServer({ draw: drawInOrder });
    const host = await server.signedIn("host@example.com");
    const id = await host.createGame({ name: "Big swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 3, maxSteals: 3, rosterMode: "self" } });
    for (const name of ["Ann", "Bob", "Cat", "Dot", "Eve"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
    await host.command(id, { type: "StartGame" });
    openApp(browser(server.origin), `/games/${id}`);

    const bar = await screen.findByRole("status", { name: /who's up/i });
    await waitFor(() => expect(within(bar).getAllByRole("paragraph")).toHaveLength(2));
    const [up, deck] = within(bar).getAllByRole("paragraph");
    expect(up).toHaveTextContent(/up now:\s*ann, bob, cat/i);
    expect(deck).toHaveTextContent(/on deck:\s*dot, eve/i);
  });

  it("says the Game hasn't started yet, before it has", async () => {
    const server = await startServer();
    const host = await server.signedIn("host@example.com");
    const id = await host.createGame({ name: "Swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3, rosterMode: "self" } });
    openApp(browser(server.origin), `/games/${id}`);

    expect(await screen.findByRole("status", { name: /who's up/i })).toHaveTextContent(/waiting for the host to start/i);
  });

  it("offers sign-in under You to someone signed out", async () => {
    const { origin, id, user } = await underway();
    openApp(browser(origin), `/games/${id}`);

    await user.click(await tab(/^you$/i));

    expect(await screen.findByRole("heading", { name: /playing\? sign in first/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send.*link/i })).toBeInTheDocument();
  });

  it("lets someone signed in join under You, then shows who they are and the Players", async () => {
    const { signedIn, id, user } = await underway();
    openApp(await signedIn("gus@example.com"), `/games/${id}`);

    await user.click(await tab(/^you$/i));

    const join = await screen.findByRole("region", { name: /play in this game/i });
    await user.type(await within(join).findByLabelText(/your name/i), "Gus");
    await user.click(within(join).getByRole("button", { name: /join as a player/i }));
    expect(await screen.findByText(/you're playing as gus/i)).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: /players/i })).getByText("Cat")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /undo|skip|open gift/i })).not.toBeInTheDocument();
  });

  it("tells a Player when it's their turn", async () => {
    const server = await startServer({ draw: drawInOrder });
    const host = await server.signedIn("host@example.com");
    const id = await host.createGame({ name: "Troop swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3, rosterMode: "self" } });
    const dee = await server.signedIn("dee@example.com");
    await dee.join(id, "Dee"); // first on the roster, so drawn first
    await host.command(id, { type: "AddPlayer", playerId: "ann", name: "Ann" });
    await host.command(id, { type: "StartGame" });
    openApp(dee, `/games/${id}`);

    await userEvent.setup().click(await tab(/^you$/i));

    expect(await screen.findByText(/it's your turn/i)).toBeInTheDocument();
    expect(screen.getByRole("status", { name: /who's up/i })).toHaveClass("mine");
  });

  it("shows a Player the Gift they're holding", async () => {
    const server = await startServer({ draw: drawInOrder });
    const host = await server.signedIn("host@example.com");
    const id = await host.createGame({ name: "Troop swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3, rosterMode: "self" } });
    const dee = await server.signedIn("dee@example.com");
    await dee.join(id, "Dee");
    const deeId = (await host.game(id))!.players[0]!.id;
    for (const name of ["Ann", "Bob"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
    await host.command(id, { type: "StartGame" });
    await host.command(id, { type: "OpenGift", playerId: deeId, giftId: "mug", name: "Mug" });
    await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "socks", name: "Socks" });
    openApp(dee, `/games/${id}`);

    await userEvent.setup().click(await tab(/^you$/i));

    expect(await screen.findByText(/you're holding:?\s*mug/i)).toBeInTheDocument();
  });

  it("posts from the Post tab, then shows the Feed with the newest Post", async () => {
    const { signedIn, id, user } = await underway();
    openApp(await signedIn("gus@example.com"), `/games/${id}`);

    await user.click(await tab(/^post/i));
    const form = await screen.findByRole("form", { name: /post to the feed/i });
    await user.type(within(form).getByLabelText(/your name/i), "Gus");
    await user.type(within(form).getByLabelText(/what's happening/i), "Nice socks!");
    await user.click(within(form).getByRole("button", { name: /^post$/i }));

    expect(await tab(/feed/i)).toHaveAttribute("aria-selected", "true");
    expect(await within(screen.getByRole("feed")).findByText("Nice socks!")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /post to the feed/i })).not.toBeInTheDocument();
  });

  it("goes back to the Gifts when the Game ends, where the Worst Gift Vote is", async () => {
    const { signedIn, host, id, user } = await underway();
    openApp(await signedIn("gus@example.com"), `/games/${id}`);
    await user.click(await tab(/feed/i));
    await screen.findByRole("feed");

    await host.command(id, { type: "EndGame" });
    await host.setVoteStatus(id, "open");

    await waitFor(async () => expect(await tab(/gifts/i)).toHaveAttribute("aria-selected", "true"));
    expect(await screen.findByRole("list", { name: /vote for the worst gift/i })).toBeInTheDocument();
  });
});
