import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { drawInOrder, openApp, startServer } from "./harness.js";

/** A started Game (Players drawn in the order added) open on the Host's phone. */
async function startedGame(settings = { activeSlots: 1, maxSteals: 3 }, players = ["Ann", "Bob", "Cat"]) {
  const { signedIn } = await startServer({ draw: drawInOrder });
  const host = await signedIn("host@example.com");
  const id = await host.createGame(settings);
  for (const name of players) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
  await host.command(id, { type: "StartGame" });
  openApp(host, `/games/${id}`);
  await screen.findByText(/up now/i);
  return userEvent.setup();
}

const turnOf = (name: string) => screen.findByRole("region", { name: new RegExp(`${name}'s turn`, "i") });
const upNow = () => screen.getByText(/up now/i);
/** Waits until the Up now line names this Player (the name is in its own element, so findByText can't match it). */
const upNowIs = (name: string) => waitFor(() => expect(upNow()).toHaveTextContent(new RegExp(`up now:\\s*${name}`, "i")));

async function openGift(user: ReturnType<typeof userEvent.setup>, player: string, gift: string) {
  const turn = await turnOf(player);
  await user.type(within(turn).getByLabelText(new RegExp(`what's in ${player}'s gift`, "i")), gift);
  await user.click(within(turn).getByRole("button", { name: /open gift/i }));
  await screen.findByRole("listitem", { name: new RegExp(gift, "i") });
}

async function steal(user: ReturnType<typeof userEvent.setup>, player: string, gift: string) {
  const turn = await turnOf(player);
  await user.click(within(turn).getByRole("button", { name: new RegExp(`steal ${gift}`, "i") }));
}

const giftRow = (gift: string) => screen.getByRole("listitem", { name: new RegExp(gift, "i") });

describe("Running the Game from the Host's phone", () => {
  it("opens a Gift for the Player who is up, then calls the next Player up", async () => {
    const user = await startedGame();

    await openGift(user, "Ann", "Socks");

    expect(giftRow("Socks")).toHaveTextContent(/socks.*ann/i);
    expect(upNow()).toHaveTextContent(/up now:\s*bob/i);
  });

  it("steals a Gift: the stealer holds it and the Victim is up next", async () => {
    const user = await startedGame();
    await openGift(user, "Ann", "Socks");

    await steal(user, "Bob", "Socks");

    await upNowIs("Ann");
    expect(giftRow("Socks")).toHaveTextContent(/socks.*bob/i);
    expect(giftRow("Socks")).toHaveTextContent(/1 steal/i);
  });

  it("doesn't offer a Frozen Gift for stealing", async () => {
    const user = await startedGame({ activeSlots: 1, maxSteals: 1 });
    await openGift(user, "Ann", "Socks");
    await steal(user, "Bob", "Socks");
    await upNowIs("Ann");

    expect(giftRow("Socks")).toHaveTextContent(/frozen/i);
    expect(within(await turnOf("Ann")).queryByRole("button", { name: /steal socks/i })).not.toBeInTheDocument();
  });

  it("explains No Take-Backs in plain words when the Victim tries to steal straight back", async () => {
    const user = await startedGame();
    await openGift(user, "Ann", "Socks");
    await steal(user, "Bob", "Socks");
    await upNowIs("Ann");

    await steal(user, "Ann", "Socks");

    expect(await screen.findByRole("alert")).toHaveTextContent(/no take-backs/i);
    expect(giftRow("Socks")).toHaveTextContent(/socks.*bob/i);
  });

  it("undoes the last Pick", async () => {
    const user = await startedGame();
    await openGift(user, "Ann", "Socks");

    await user.click(screen.getByRole("button", { name: /undo/i }));

    await upNowIs("Ann");
    expect(screen.queryByRole("listitem", { name: /socks/i })).not.toBeInTheDocument();
  });

  it("says so when there's nothing to undo", async () => {
    const user = await startedGame();
    await user.click(screen.getByRole("button", { name: /undo/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/no pick to undo/i);
  });

  it("skips a Player who isn't here, calling the next one up", async () => {
    const user = await startedGame();

    await user.click(within(await turnOf("Ann")).getByRole("button", { name: /skip ann/i }));

    await upNowIs("Bob");
    expect(screen.getByText(/on deck/i)).toHaveTextContent(/on deck:\s*cat/i);
  });

  it("gives each active Player their own turn when several play at once", async () => {
    const user = await startedGame({ activeSlots: 2, maxSteals: 3 }, ["Ann", "Bob", "Cat", "Dan"]);

    await openGift(user, "Bob", "Mug");

    expect(await turnOf("Ann")).toBeInTheDocument();
    expect(await turnOf("Cat")).toBeInTheDocument();
    expect(giftRow("Mug")).toHaveTextContent(/mug.*bob/i);
  });
});
