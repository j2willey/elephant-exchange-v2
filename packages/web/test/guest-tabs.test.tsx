import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { browser, drawInOrder, openApp, startServer } from "./harness.js";

/** A Self sign-up Game under way: Ann opened Socks, so Bob is up. */
async function underway() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ activeSlots: 1, maxSteals: 3 }, "Troop swap", "self");
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
    for (const name of [/up now/i, /feed/i, /post/i]) expect(await tab(name)).toHaveAttribute("aria-selected", "false");
    expect(await screen.findByRole("listitem", { name: "Socks" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Troop swap" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /big screen|link to this game|settings/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/up now:/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("feed")).not.toBeInTheDocument();
  });

  it("shows who's up, who's on deck and the Players under Up now, where a guest can join", async () => {
    const { signedIn, id, user } = await underway();
    openApp(await signedIn("gus@example.com"), `/games/${id}`);

    await user.click(await tab(/up now/i));

    // Ann opened her Gift, so it's Bob's turn.
    expect(await screen.findByText(/up now:/i)).toHaveTextContent(/up now:\s*bob/i);
    expect(screen.getByText(/on deck:/i)).toHaveTextContent(/on deck:\s*cat/i);
    expect(within(screen.getByRole("list", { name: /players/i })).getByText("Cat")).toBeInTheDocument();
    const join = screen.getByRole("region", { name: /play in this game/i });
    await user.type(await within(join).findByLabelText(/your name/i), "Gus");
    await user.click(within(join).getByRole("button", { name: /join as a player/i }));
    expect(await screen.findByText(/you're playing as gus/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /undo|skip|open gift/i })).not.toBeInTheDocument();
  });

  it("tells a Player when it's their turn", async () => {
    const server = await startServer({ draw: drawInOrder });
    const host = await server.signedIn("host@example.com");
    const id = await host.createGame({ activeSlots: 1, maxSteals: 3 }, "Troop swap", "self");
    const dee = await server.signedIn("dee@example.com");
    await dee.join(id, "Dee"); // first on the roster, so drawn first
    await host.command(id, { type: "AddPlayer", playerId: "ann", name: "Ann" });
    await host.command(id, { type: "StartGame" });
    openApp(dee, `/games/${id}`);

    await userEvent.setup().click(await tab(/up now/i));

    expect(await screen.findByText(/it's your turn/i)).toBeInTheDocument();
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
