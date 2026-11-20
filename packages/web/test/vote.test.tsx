import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { browser, drawInOrder, openApp, startServer } from "./harness.js";

/** A Game just ended: Ann holds Socks, Bob the Mug, Cat the Candle. */
async function ended({ end = true } = {}) {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
  for (const name of ["Ann", "Bob", "Cat"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
  await host.command(id, { type: "StartGame" });
  await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });
  await host.command(id, { type: "OpenGift", playerId: "bob", giftId: "g2", name: "Mug" });
  await host.command(id, { type: "OpenGift", playerId: "cat", giftId: "g3", name: "Candle" });
  if (end) await host.command(id, { type: "EndGame" });
  return { ...server, host, id, user: userEvent.setup() };
}

const panel = () => screen.findByRole("region", { name: /worst gift vote/i });
const ballot = async () => within(await panel()).findByRole("list", { name: /vote for the worst gift/i });
const voteButton = async (gift: string) => within(await ballot()).getByRole("button", { name: new RegExp(`^${gift}\\b`, "i") });

describe("The Worst Gift Vote, on phones", () => {
  it("is started by the Host once the Game is over, and then everyone signed in can vote", async () => {
    const { host, signedIn, id, user } = await ended();
    const hostScreen = openApp(host, `/games/${id}`);
    await user.click(within(await panel()).getByRole("button", { name: /start the vote/i }));
    await within(await panel()).findByText(/0 votes cast/i);
    hostScreen.unmount();

    openApp(await signedIn("gus@example.com"), `/games/${id}`);
    await user.click(await voteButton("Mug"));

    await waitFor(async () => expect(await voteButton("Mug")).toHaveAttribute("aria-pressed", "true"));
    expect(await voteButton("Socks")).toHaveAttribute("aria-pressed", "false");
    await within(await panel()).findByText(/1 vote cast/i);
  });

  it("lets a voter move their vote, and shows the counts live under the Live display", async () => {
    const { host, signedIn, id, user } = await ended();
    await host.setVoteStatus(id, "open");
    await (await signedIn("dot@example.com")).vote(id, "g1");
    openApp(await signedIn("gus@example.com"), `/games/${id}`);

    await user.click(await voteButton("Mug"));
    await user.click(await voteButton("Socks"));

    await waitFor(async () => expect(await voteButton("Socks")).toHaveAttribute("aria-pressed", "true"));
    expect(await voteButton("Mug")).toHaveAttribute("aria-pressed", "false");
    await waitFor(async () => expect(await voteButton("Socks")).toHaveTextContent(/2 votes/i));
  });

  it("shows phones no counts while the Host has them hidden", async () => {
    const { host, signedIn, id } = await ended();
    await host.setVoteStatus(id, "open");
    await host.setVoteDisplay(id, "hidden");
    await (await signedIn("dot@example.com")).vote(id, "g1");

    openApp(await signedIn("gus@example.com"), `/games/${id}`);

    await within(await panel()).findByText(/1 vote cast/i);
    expect(await voteButton("Socks")).not.toHaveTextContent(/vote/i);
  });

  it("lets the Host switch what the big screen shows", async () => {
    const { host, origin, id, user } = await ended();
    await host.setVoteStatus(id, "open");
    openApp(host, `/games/${id}`);

    await user.click(within(await panel()).getByRole("radio", { name: /parade/i }));

    await waitFor(async () => expect((await browser(origin).game(id))?.vote.display).toBe("parade"));
  });

  it("asks the Host to pick the winner when Gifts tie, then everyone sees who won", async () => {
    const { host, signedIn, origin, id, user } = await ended();
    await host.setVoteStatus(id, "open");
    await (await signedIn("v1@example.com")).vote(id, "g1");
    await (await signedIn("v2@example.com")).vote(id, "g2");
    const hostScreen = openApp(host, `/games/${id}`);

    await user.click(within(await panel()).getByRole("button", { name: /close the vote/i }));
    const pick = await within(await panel()).findByRole("group", { name: /pick the winner/i });
    expect(within(pick).getAllByRole("button").map((b) => b.textContent)).toEqual([expect.stringMatching(/socks/i), expect.stringMatching(/mug/i)]);
    await user.click(within(pick).getByRole("button", { name: /mug/i }));
    await within(await panel()).findByText(/worst gift: mug/i);
    hostScreen.unmount();

    openApp(browser(origin), `/games/${id}`);
    expect(await within(await panel()).findByText(/worst gift: mug/i)).toHaveTextContent(/held by bob/i);
  });

  it("offers someone signed out a way to sign in to vote", async () => {
    const { host, origin, id } = await ended();
    await host.setVoteStatus(id, "open");
    openApp(browser(origin), `/games/${id}`);

    expect(await within(await panel()).findByRole("button", { name: /send.*link/i })).toBeInTheDocument();
    expect(within(await panel()).queryByRole("list", { name: /vote for the worst gift/i })).not.toBeInTheDocument();
  });

  it("isn't offered while the Game is still going", async () => {
    const { host, id } = await ended({ end: false });
    openApp(host, `/games/${id}`);
    await screen.findByRole("list", { name: /gifts/i });
    expect(screen.queryByRole("region", { name: /worst gift vote/i })).not.toBeInTheDocument();
  });
});
