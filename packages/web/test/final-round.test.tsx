import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { drawInOrder, openApp, startServer } from "./harness.js";

/**
 * Ann, Bob and Cat have each opened a Gift (Socks, Mug, Candle), so every Turn is done.
 * Opens the Host's page unless told which path to open.
 */
async function everyoneHasAGift(path?: (id: string) => string) {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
  for (const name of ["Ann", "Bob", "Cat"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
  await host.command(id, { type: "StartGame" });
  await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });
  await host.command(id, { type: "OpenGift", playerId: "bob", giftId: "g2", name: "Mug" });
  await host.command(id, { type: "OpenGift", playerId: "cat", giftId: "g3", name: "Candle" });
  openApp(host, path ? path(id) : `/games/${id}`);
  return { ...server, host, id, user: userEvent.setup() };
}

const turnOf = (name: string) => screen.findByRole("region", { name: new RegExp(`${name}'s (final )?turn`, "i") });
const giftRow = (gift: string) => screen.getByRole("listitem", { name: new RegExp(gift, "i") });
const upNowIs = (name: string) =>
  waitFor(() => expect(screen.getByText(/up now/i).closest("section")).toHaveTextContent(new RegExp(`up now\\W*${name}`, "i")));

async function startFinalRound(user: ReturnType<typeof userEvent.setup>, finalists: string, leftovers: string) {
  const panel = await screen.findByRole("region", { name: /final round/i });
  await user.clear(within(panel).getByLabelText(/how many players get a final chance/i));
  await user.type(within(panel).getByLabelText(/how many players get a final chance/i), finalists);
  await user.clear(within(panel).getByLabelText(/unopened gifts are left/i));
  await user.type(within(panel).getByLabelText(/unopened gifts are left/i), leftovers);
  await user.click(within(panel).getByRole("button", { name: /start the final round/i }));
  await screen.findByRole("heading", { name: /^final round$/i });
}

describe("The Final Round", () => {
  it("isn't offered while Turns are still going", async () => {
    const server = await startServer({ draw: drawInOrder });
    const host = await server.signedIn("host@example.com");
    const id = await host.createGame({ options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    for (const name of ["Ann", "Bob"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
    await host.command(id, { type: "StartGame" });
    openApp(host, `/games/${id}`);
    await turnOf("Ann");

    expect(screen.queryByRole("region", { name: /final round/i })).not.toBeInTheDocument();
  });

  it("starts once every Player has a Gift, calling up the first Players in the order they were drawn", async () => {
    const { user } = await everyoneHasAGift();

    await startFinalRound(user, "2", "1");

    await upNowIs("Ann");
    expect(screen.getByText(/on deck/i).closest("section")).toHaveTextContent(/on deck\W*bob/i);
    expect(screen.getByText(/1 unopened gift left/i)).toBeInTheDocument();
  });

  it("lets a Final Round Player keep their Gift, calling up the next", async () => {
    const { user } = await everyoneHasAGift();
    await startFinalRound(user, "2", "0");

    await user.click(within(await turnOf("Ann")).getByRole("button", { name: /keep socks/i }));

    await upNowIs("Bob");
  });

  it("tells a Final Round Player that anything but Keep puts their Gift back, and opening one does", async () => {
    const { user } = await everyoneHasAGift();
    await startFinalRound(user, "2", "1");

    const ann = await turnOf("Ann");
    expect(ann).toHaveTextContent(/or put socks back on the table, then/i);
    await user.type(within(ann).getByPlaceholderText(/what's in ann's gift/i), "Snow Globe");
    await user.click(within(ann).getByRole("button", { name: /open gift/i }));

    await upNowIs("Bob");
    expect(giftRow("Socks")).toHaveTextContent(/on the table/i);
    expect(giftRow("Snow Globe")).toHaveTextContent(/ann/i);
  });

  it("puts a stealer's old Gift on the table, where it can be taken", async () => {
    const { user } = await everyoneHasAGift();
    await startFinalRound(user, "2", "0");

    await user.click(within(await turnOf("Ann")).getByRole("button", { name: /steal mug/i }));

    await upNowIs("Bob");
    expect(giftRow("Socks")).toHaveTextContent(/on the table/i);
    await user.click(within(await turnOf("Bob")).getByRole("button", { name: /take socks/i }));
    await waitFor(() => expect(giftRow("Socks")).toHaveTextContent(/socks.*bob/i));
  });

  it("lets a Final Round Player open one of the leftover Gifts", async () => {
    const { user } = await everyoneHasAGift();
    await startFinalRound(user, "1", "2");
    const turn = await turnOf("Ann");

    await user.type(within(turn).getByLabelText(/what's in ann's gift/i), "Scarf");
    await user.click(within(turn).getByRole("button", { name: /open gift/i }));

    expect(await screen.findByRole("listitem", { name: /scarf/i })).toHaveTextContent(/scarf.*ann/i);
    expect(screen.getByText(/1 unopened gift left/i)).toBeInTheDocument();
  });
});

describe("Ending the Game", () => {
  it("lets the Host end it at any moment, after making sure", async () => {
    const server = await startServer({ draw: drawInOrder });
    const host = await server.signedIn("host@example.com");
    const id = await host.createGame({ options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    for (const name of ["Ann", "Bob"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
    await host.command(id, { type: "StartGame" });
    openApp(host, `/games/${id}`);
    const user = userEvent.setup();
    await turnOf("Ann"); // mid-Turn

    // It's on the settings page, away from the buttons tapped all evening.
    await user.click(screen.getByRole("link", { name: /settings/i }));
    await user.click(await screen.findByRole("button", { name: /end the game/i }));
    await user.click(screen.getByRole("button", { name: /keep playing/i }));
    await user.click(screen.getByRole("link", { name: /back to the game/i }));
    expect(await turnOf("Ann")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /settings/i }));
    await user.click(await screen.findByRole("button", { name: /end the game/i }));
    await user.click(screen.getByRole("button", { name: /yes, end it now/i }));
    // and back to the Game, where the Vote is

    expect(await screen.findByRole("heading", { name: /game over/i })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /turn/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/player's name/i)).not.toBeInTheDocument();
  });

  it("shows Game over and who got what on the watch screen", async () => {
    const { host, id } = await everyoneHasAGift((id) => `/games/${id}/screen`);
    await screen.findByRole("listitem", { name: /candle/i });

    await host.command(id, { type: "EndGame" });

    expect(await screen.findByRole("heading", { name: /game over/i })).toBeInTheDocument();
    expect(giftRow("Candle")).toHaveTextContent(/candle.*cat/i);
  });
});
