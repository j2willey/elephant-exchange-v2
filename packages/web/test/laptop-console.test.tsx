import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawInOrder, openApp, startServer } from "./harness.js";

/** A laptop: wide enough for the two-column Host console (the test browser has no screen size of its own). */
function screenWidth(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: wide && query.includes("min-width"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}
beforeEach(() => screenWidth(true));
afterEach(() => vi.unstubAllGlobals());

async function hosting(players: string[] = []) {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ activeSlots: 1, maxSteals: 3 }, "Acme Holiday Party");
  for (const name of players) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
  return { ...server, host, id, user: userEvent.setup() };
}

const participants = () => screen.findByRole("region", { name: /participants/i });
const tracker = () => screen.findByRole("region", { name: /gift tracker/i });
const row = async (name: string) => within(await participants()).findByRole("listitem", { name: new RegExp(`^${name}\\b`) });
const giftRow = async (name: string) => within(await tracker()).findByRole("listitem", { name });

describe("The Host console on a laptop", () => {
  it("is v1's layout: a banner, a menu bar, Participants beside the Gift Tracker, and End Game at the foot", async () => {
    const { host, id } = await hosting(["Ann", "Bob"]);
    openApp(host, `/games/${id}`);

    expect(await screen.findByRole("banner")).toHaveTextContent("Acme Holiday Party");
    const menu = screen.getByRole("navigation", { name: /console/i });
    expect(within(menu).getByRole("link", { name: /scoreboard/i })).toHaveAttribute("target", "_blank");
    expect(within(menu).getByRole("link", { name: /scoreboard/i })).toHaveAttribute("href", `/games/${id}/screen`);
    expect(within(menu).getByRole("link", { name: /settings/i })).toHaveAttribute("href", `/games/${id}/settings`);
    expect(within(menu).getByRole("button", { name: /invite/i })).toBeInTheDocument();
    expect(await participants()).toBeInTheDocument();
    expect(await tracker()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /end game/i })).toBeInTheDocument();
  });

  it("adds Participants and starts the Game; the Player who's up comes first, with the turn's buttons", async () => {
    const { host, id, user } = await hosting();
    openApp(host, `/games/${id}`);

    const list = await participants();
    for (const name of ["Ann", "Bob", "Cat"]) {
      await user.type(within(list).getByLabelText(/participant's name/i), name);
      await user.click(within(list).getByRole("button", { name: /^add$/i }));
      await within(list).findByText(name);
    }
    await user.click(within(list).getByRole("button", { name: /start game/i }));

    const ann = await row("Ann");
    for (const action of [/open/i, /steal/i, /skip/i]) expect(within(ann).getByRole("button", { name: action })).toBeInTheDocument();
    const names = within(list)
      .getAllByRole("listitem")
      .map((li) => li.getAttribute("aria-label")!.split(" ")[0]);
    expect(names[0]).toBe("Ann");
    expect(within(await row("Bob")).getByText(/on deck/i)).toBeInTheDocument();
  });

  it("opens a Gift from a dialog, and the Gift Tracker shows who holds it and its steals", async () => {
    const { host, id, user } = await hosting(["Ann", "Bob"]);
    await host.command(id, { type: "StartGame" });
    openApp(host, `/games/${id}`);

    await user.click(within(await row("Ann")).getByRole("button", { name: /open/i }));
    const dialog = await screen.findByRole("dialog", { name: /ann/i });
    await user.type(within(dialog).getByLabelText(/what's inside/i), "Bluetooth speaker");
    await user.click(within(dialog).getByRole("button", { name: /save/i }));

    const gift = await giftRow("Bluetooth speaker");
    expect(gift).toHaveTextContent(/held by ann/i);
    expect(gift).toHaveTextContent(/0\/3 steals/i);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("steals by picking a Gift in the Gift Tracker, as in v1", async () => {
    const { host, id, user } = await hosting(["Ann", "Bob"]);
    await host.command(id, { type: "StartGame" });
    await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "speaker", name: "Speaker" });
    openApp(host, `/games/${id}`);

    await user.click(within(await row("Bob")).getByRole("button", { name: /steal/i }));
    expect(within(await row("Bob")).getByText(/select a gift/i)).toBeInTheDocument();
    await user.click(within(await giftRow("Speaker")).getByRole("button", { name: /select gift/i }));

    await waitFor(async () => expect(await giftRow("Speaker")).toHaveTextContent(/held by bob/i));
    expect(await giftRow("Speaker")).toHaveTextContent(/1\/3 steals/i);
  });

  it("can cancel a steal, skip a Player, and undo a Pick", async () => {
    const { host, id, user } = await hosting(["Ann", "Bob", "Cat"]);
    await host.command(id, { type: "StartGame" });
    openApp(host, `/games/${id}`);

    await user.click(within(await row("Ann")).getByRole("button", { name: /steal/i }));
    await user.click(within(await row("Ann")).getByRole("button", { name: /cancel/i }));
    expect(within(await row("Ann")).getByRole("button", { name: /open/i })).toBeInTheDocument();

    await user.click(within(await row("Ann")).getByRole("button", { name: /skip/i }));
    await waitFor(async () => expect(within(await row("Bob")).getByRole("button", { name: /open/i })).toBeInTheDocument());

    // Undo takes back a Pick (an open or a steal), not a Skip.
    await host.command(id, { type: "OpenGift", playerId: "bob", giftId: "mug", name: "Mug" });
    await giftRow("Mug");
    await user.click(screen.getByRole("button", { name: /undo/i }));
    await waitFor(async () => expect(within(await row("Bob")).getByRole("button", { name: /open/i })).toBeInTheDocument());
    expect(within(await tracker()).queryByRole("listitem", { name: "Mug" })).not.toBeInTheDocument();
  });
});

describe("The Host console on a phone", () => {
  it("stays the single column it is", async () => {
    screenWidth(false);
    const { host, id } = await hosting(["Ann", "Bob"]);
    openApp(host, `/games/${id}`);

    expect(await screen.findByText(/host console/i)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /participants/i })).not.toBeInTheDocument();
  });
});
