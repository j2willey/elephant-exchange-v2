import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { drawInOrder, openApp, startServer } from "./harness.js";

/** A Game just ended with the vote open, its big screen up: Ann holds Socks, Bob the Mug, Cat the Candle. */
async function votingOnTheBigScreen() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ activeSlots: 1, maxSteals: 3 });
  for (const name of ["Ann", "Bob", "Cat"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
  await host.command(id, { type: "StartGame" });
  await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });
  await host.command(id, { type: "OpenGift", playerId: "bob", giftId: "g2", name: "Mug" });
  await host.command(id, { type: "OpenGift", playerId: "cat", giftId: "g3", name: "Candle" });
  await host.command(id, { type: "EndGame" });
  await host.setVoteStatus(id, "open");
  let voters = 0;
  const votes = async (...giftIds: string[]) => {
    for (const giftId of giftIds) await (await server.signedIn(`voter${++voters}@example.com`)).vote(id, giftId);
  };
  openApp(host, `/games/${id}/screen`);
  return { ...server, host, id, votes };
}

const tally = () => screen.findByRole("list", { name: /votes so far/i });

describe("The vote on the big screen", () => {
  it("shows the counts growing as votes come in, under the Live display", async () => {
    const { votes } = await votingOnTheBigScreen();
    await screen.findByText(/vote for the worst gift/i);

    await votes("g2", "g2", "g1");

    await waitFor(async () => expect(within(await tally()).getByRole("listitem", { name: "Mug" })).toHaveTextContent(/2 votes/i));
    expect(within(await tally()).getByRole("listitem", { name: "Socks" })).toHaveTextContent(/1 vote\b/i);
    expect(screen.getByText(/3 votes cast/i)).toBeInTheDocument();
  });

  it("keeps the counts to itself under Hidden, though it says how many have voted", async () => {
    const { host, id, votes } = await votingOnTheBigScreen();
    await host.setVoteDisplay(id, "hidden");
    await votes("g2", "g1");

    await screen.findByText(/2 votes cast/i);
    expect(screen.queryByRole("list", { name: /votes so far/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ votes?$/i)).not.toBeInTheDocument();
  });

  it("parades every Gift and who holds it, as a reminder", async () => {
    const { host, id } = await votingOnTheBigScreen();
    await host.setVoteDisplay(id, "parade");

    const parade = await screen.findByRole("list", { name: /gift parade/i });
    expect(within(parade).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringMatching(/socks.*ann/i),
      expect.stringMatching(/mug.*bob/i),
      expect.stringMatching(/candle.*cat/i),
    ]);
  });

  it("reveals the worst Gift and the top three when the vote closes", async () => {
    const { host, id, votes } = await votingOnTheBigScreen();
    await host.setVoteDisplay(id, "hidden");
    await votes("g2", "g2", "g2", "g1", "g1", "g3");

    await host.setVoteStatus(id, "closed");

    await screen.findByText(/worst gift: mug/i);
    expect(screen.getByText(/bob picks a prize/i)).toBeInTheDocument();
    const podium = screen.getByRole("list", { name: /results/i });
    expect(within(podium).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringMatching(/mug.*3 votes/i),
      expect.stringMatching(/socks.*2 votes/i),
      expect.stringMatching(/candle.*1 vote/i),
    ]);
  });
});
