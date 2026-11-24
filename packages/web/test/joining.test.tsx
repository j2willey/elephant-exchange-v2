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

  it("asks the Host to add them when the Host enters the Players, and they're in once the Host taps Add", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const id = await host.createGame({ name: "Office swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    await host.command(id, { type: "AddPlayer", playerId: "ann", name: "Ann" });

    openApp(await signedIn("dan@example.com"), `/games/${id}`);
    const user = userEvent.setup();
    await onTab(/^you$/i);
    await screen.findByText("Ann");
    const panel = await screen.findByRole("form", { name: /join this game/i });
    await user.type(within(panel).getByLabelText(/your name/i), "Dan");
    await user.click(within(panel).getByRole("checkbox", { name: /ask the host to add me/i }));
    await user.click(within(panel).getByRole("button", { name: /ask to play/i }));
    expect(await screen.findByText(/you've asked to play/i)).toBeInTheDocument();

    // The Host adds them; their phone hears it by itself.
    const [asking] = await host.askingToPlay(id);
    expect(asking?.name).toBe("Dan");
    await host.answerAsk(id, asking!.key, true);
    expect(await screen.findByText(/you're playing as dan/i)).toBeInTheDocument();
    await waitFor(() => expect(rosterNames()).toEqual(["Ann", "Dan"]));
  });

  it("shows the Host who's asking to play, to add with a tap or not", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const id = await host.createGame({ name: "Office swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    await (await signedIn("dan@example.com")).askToPlay(id, "Dan");
    await (await signedIn("eve@example.com")).askToPlay(id, "Eve");
    openApp(host, `/games/${id}`);
    const user = userEvent.setup();

    const card = await screen.findByRole("region", { name: /asking to play/i });
    await user.click(within(within(card).getByRole("listitem", { name: "Dan" })).getByRole("button", { name: /add as player/i }));
    await user.click(within(within(card).getByRole("listitem", { name: "Eve" })).getByRole("button", { name: /not playing/i }));

    await waitFor(() => expect(screen.queryByRole("region", { name: /asking to play/i })).not.toBeInTheDocument());
    await waitFor(() => expect(rosterNames()).toEqual(["Dan"]));
  });

  it("can take back asking to play, and ask again", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const id = await host.createGame({ name: "Office swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    const dan = await signedIn("dan@example.com");
    await dan.changeMyName(id, "Dan");
    openApp(dan, `/games/${id}`);
    const user = userEvent.setup();
    await onTab(/^you$/i);

    await user.click(await screen.findByRole("button", { name: /i brought a gift: ask to play/i }));
    expect(await screen.findByText(/you've asked to play/i)).toBeInTheDocument();
    expect(await host.askingToPlay(id)).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: /take it back/i }));
    expect(await screen.findByRole("button", { name: /i brought a gift: ask to play/i })).toBeInTheDocument();
    expect(await host.askingToPlay(id)).toEqual([]);
  });
});
