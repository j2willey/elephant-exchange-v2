import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { browser, openApp, startServer } from "./harness.js";

beforeEach(() => localStorage.clear());

const THREE = [/set up the game ahead of time/i, /send the link/i, /bring 2 to 5 extra gifts/i];

describe("The three things to do before the party", () => {
  it("are on the front page and in the Host's Guide", async () => {
    const { origin } = await startServer();
    openApp(browser(origin));
    const card = await screen.findByRole("region", { name: /three things to do before the party/i });
    for (const thing of THREE) expect(within(card).getByText(thing)).toBeInTheDocument();
    expect(card).toHaveTextContent(/worst gift vote/i);
    expect(card).not.toHaveTextContent(/needs? a phone|must/i);
    cleanup();

    openApp(browser(origin), "/guide");
    await screen.findByRole("heading", { name: /before the party/i });
    for (const thing of THREE) expect(screen.getByText(thing)).toBeInTheDocument();
    expect(screen.getByText(/email invitations/i)).toBeInTheDocument();
    expect(screen.getByText(/the extra gifts/i)).toBeInTheDocument();
  });

  it("are on a new Game's console with what to tap for each, until the Host hides them", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const id = await host.createGame({ name: "Office swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    const first = openApp(host, `/games/${id}`);
    const user = userEvent.setup();

    const card = await screen.findByRole("region", { name: /before the party/i });
    expect(within(card).getByRole("link", { name: /add when & where/i })).toHaveAttribute("href", `/games/${id}/settings`);
    first.unmount();

    await host.setGameOptions(id, { whenWhere: "Fri 10 am · Room B" });
    openApp(host, `/games/${id}`);
    const again = await screen.findByRole("region", { name: /before the party/i });
    expect(await within(again).findByText(/✓ fri 10 am · room b/i)).toBeInTheDocument();
    await user.click(within(again).getByRole("button", { name: /got it, hide this/i }));
    expect(screen.queryByRole("region", { name: /before the party/i })).not.toBeInTheDocument();
    cleanup();

    openApp(host, `/games/${id}`);
    await screen.findByRole("heading", { name: "Office swap" });
    expect(screen.queryByRole("region", { name: /before the party/i })).not.toBeInTheDocument();
  });

  it("aren't shown to guests, or once the Game has started", async () => {
    const { signedIn, origin } = await startServer();
    const host = await signedIn("host@example.com");
    const id = await host.createGame({ name: "Office swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    openApp(browser(origin), `/games/${id}`);
    await screen.findByRole("tab", { name: /gifts/i });
    expect(screen.queryByRole("region", { name: /before the party/i })).not.toBeInTheDocument();
    cleanup();

    for (const name of ["Ann", "Bob"]) await host.command(id, { type: "AddPlayer", playerId: name, name });
    await host.command(id, { type: "StartGame" });
    openApp(host, `/games/${id}`);
    await screen.findByRole("heading", { name: "Office swap" });
    expect(screen.queryByRole("region", { name: /before the party/i })).not.toBeInTheDocument();
  });
});
