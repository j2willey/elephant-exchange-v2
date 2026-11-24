import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { browser, onTab, openApp, startServer } from "./harness.js";

const rosterNames = () =>
  within(screen.getByRole("list", { name: /players/i }))
    .getAllByRole("listitem")
    .map((li) => li.querySelector("[data-name]")?.textContent);

async function joinAs(name: string) {
  const user = userEvent.setup();
  await onTab(/^you$/i);
  const panel = await screen.findByRole("form", { name: /join this game/i });
  await user.clear(await within(panel).findByLabelText(/your name/i));
  await user.type(within(panel).getByLabelText(/your name/i), name);
  await user.click(within(panel).getByRole("checkbox", { name: /i brought a gift/i }));
  await user.click(within(panel).getByRole("button", { name: /join as a player/i }));
  return user;
}

describe("Joining a Game from a phone", () => {
  it("lets the Host choose Self sign-up when creating the Game", async () => {
    const { signedIn } = await startServer();
    openApp(await signedIn("host@example.com"));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /new game/i }));

    await user.click(screen.getByRole("button", { name: /customize settings/i }));
    await user.click(screen.getByRole("radio", { name: /players sign up on their phones/i }));
    await user.click(screen.getByRole("button", { name: /create the game/i }));

    expect(await screen.findByText(/players can sign up on their phones/i)).toBeInTheDocument();
  });

  it("lets a signed-in person add themselves as a Player, and the Host sees them arrive", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const id = await host.createGame({ name: "Troop swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3, rosterMode: "self" } });
    await host.command(id, { type: "AddPlayer", playerId: "ann", name: "Ann" });
    const hostScreen = openApp(host, `/games/${id}`);
    await screen.findByText("Ann");
    hostScreen.unmount();

    const dan = await signedIn("dan@example.com");
    const danScreen = openApp(dan, `/games/${id}`);
    await joinAs("Dan");

    expect(await screen.findByText(/you're playing as dan/i)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /join this game/i })).not.toBeInTheDocument();
    danScreen.unmount();

    openApp(host, `/games/${id}`);
    await waitFor(() => expect(rosterNames()).toEqual(["Ann", "Dan"]));
  });

  it("remembers who they are after a reload, and doesn't offer to join again", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const id = await host.createGame({ name: "Troop swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3, rosterMode: "self" } });
    const dan = await signedIn("dan@example.com");
    const first = openApp(dan, `/games/${id}`);
    await joinAs("Dan");
    await screen.findByText(/you're playing as dan/i);
    first.unmount();

    openApp(dan, `/games/${id}`);
    await onTab(/^you$/i);

    expect(await screen.findByText(/you're playing as dan/i)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /join this game/i })).not.toBeInTheDocument();
  });

  it("signs in someone who arrived from the QR code and brings them back to the Game", async () => {
    const { origin, signedIn, linkFor } = await startServer();
    const host = await signedIn("host@example.com");
    const id = await host.createGame({ name: "Troop swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3, rosterMode: "self" } });
    const phone = browser(origin);
    const first = openApp(phone, `/games/${id}`);
    const user = userEvent.setup();
    await onTab(/^you$/i);
    const panel = await screen.findByRole("form", { name: /join this game/i });

    await user.type(await within(panel).findByLabelText(/your name/i), "Eve");
    await user.type(within(panel).getByLabelText(/email/i), "eve@example.com");
    await user.click(within(panel).getByRole("checkbox", { name: /i brought a gift/i }));
    await user.click(within(panel).getByRole("button", { name: /email me a link/i }));
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    first.unmount();

    // The link brings them back to the Game, and they're in as a Player without asking again.
    openApp(phone, linkFor("eve@example.com"));
    expect(await screen.findByRole("heading", { name: "Troop swap" })).toBeInTheDocument();
    await onTab(/^you$/i);
    expect(await screen.findByText(/you're playing as eve/i)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /join this game/i })).not.toBeInTheDocument();
  });

  it("lets someone join after the Game has started, as a Late Arrival", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const id = await host.createGame({ name: "Troop swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3, rosterMode: "self" } });
    for (const name of ["Ann", "Bob"]) await host.command(id, { type: "AddPlayer", playerId: name, name });
    await host.command(id, { type: "StartGame" });
    openApp(await signedIn("dan@example.com"), `/games/${id}`);

    await joinAs("Dan");

    expect(await screen.findByText(/you're playing as dan/i)).toBeInTheDocument();
    expect(rosterNames()).toEqual(["Ann", "Bob", "Dan"]);
  });

  it("isn't offered as a Player when the Host enters the Players: they join as a Guest", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const id = await host.createGame({ name: "Office swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    await host.command(id, { type: "AddPlayer", playerId: "ann", name: "Ann" });

    openApp(await signedIn("dan@example.com"), `/games/${id}`);
    await onTab(/^you$/i);

    await screen.findByText("Ann");
    const panel = await screen.findByRole("form", { name: /join this game/i });
    expect(within(panel).queryByRole("checkbox", { name: /i brought a gift/i })).not.toBeInTheDocument();
    expect(within(panel).getByText(/the host adds the players/i)).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /join as a guest/i })).toBeInTheDocument();
  });
});
