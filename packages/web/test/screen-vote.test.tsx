import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { drawInOrder, openApp, startServer } from "./harness.js";

/** A Game just ended with the vote open, its big screen up: Ann holds Socks, Bob the Mug, Cat the Candle. */
async function votingOnTheBigScreen() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
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

/** A small, real JPEG, as a phone's photo picker would hand over. */
const jpeg = Uint8Array.from(
  atob(
    "/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAeACgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAQG/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AsAM2vAAAAAAAAAAf/9k=",
  ),
  (c) => c.charCodeAt(0),
);

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

  it("ranks the top five, like v1's podium", async () => {
    const server = await startServer({ draw: drawInOrder });
    const host = await server.signedIn("host@example.com");
    const id = await host.createGame({ options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    const names = ["Ann", "Bob", "Cat", "Dan", "Eve", "Fay"];
    const gifts = ["Socks", "Mug", "Candle", "Fish", "Lamp", "Cake"];
    for (const name of names) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
    await host.command(id, { type: "StartGame" });
    for (const [i, name] of names.entries()) await host.command(id, { type: "OpenGift", playerId: name.toLowerCase(), giftId: `g${i}`, name: gifts[i]! });
    await host.command(id, { type: "EndGame" });
    await host.setVoteStatus(id, "open");
    let voter = 0;
    // Socks 6 votes, Mug 5, … Cake 1.
    for (const [i] of gifts.entries()) for (let n = 0; n < 6 - i; n++) await (await server.signedIn(`v${++voter}@example.com`)).vote(id, `g${i}`);
    openApp(host, `/games/${id}/screen`);

    await host.setVoteStatus(id, "closed");

    const podium = await screen.findByRole("list", { name: /results/i });
    expect(within(podium).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringMatching(/socks.*ann.*6 votes/i),
      expect.stringMatching(/mug.*bob.*5 votes/i),
      expect.stringMatching(/candle.*cat.*4 votes/i),
      expect.stringMatching(/fish.*dan.*3 votes/i),
      expect.stringMatching(/lamp.*eve.*2 votes/i),
    ]);
  });

  it("shows a Photo of the worst Gift, if anyone posted one", async () => {
    const { host, id, votes, signedIn } = await votingOnTheBigScreen();
    const gus = await signedIn("gus@example.com");
    await gus.post(id, { text: "Behold", name: "Gus", giftId: "g2", photo: new File([jpeg], "mug.jpg", { type: "image/jpeg" }) });
    await votes("g2");

    await host.setVoteStatus(id, "closed");

    const reveal = await screen.findByRole("region", { name: /results/i });
    await waitFor(() => expect(within(reveal).getByRole("img", { name: /photo from gus/i })).toBeInTheDocument());
  });

  it("thanks everyone for playing once the results are in", async () => {
    const { host, id, votes } = await votingOnTheBigScreen();
    await votes("g1");

    await host.setVoteStatus(id, "closed");

    expect(await screen.findByText(/thanks for playing/i)).toBeInTheDocument();
  });

  it("thanks everyone too when the Game ends with no vote", async () => {
    const server = await startServer({ draw: drawInOrder });
    const host = await server.signedIn("host@example.com");
    const id = await host.createGame({ options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    for (const name of ["Ann", "Bob"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
    await host.command(id, { type: "StartGame" });
    await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });
    openApp(host, `/games/${id}/screen`);

    await host.command(id, { type: "EndGame" });

    expect(await screen.findByText(/game over/i)).toBeInTheDocument();
    expect(screen.getByText(/thanks for playing/i)).toBeInTheDocument();
  });
});
