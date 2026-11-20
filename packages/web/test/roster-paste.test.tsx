import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browser, openApp, startServer } from "./harness.js";

/** The test browser has no screen size of its own: wide is a laptop, narrow a phone. */
function screenWidth(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: wide && query.includes("min-width"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}
afterEach(() => vi.unstubAllGlobals());

async function newGame() {
  const server = await startServer();
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ name: "Acme Holiday Party", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
  return { ...server, host, id, user: userEvent.setup() };
}

const names = async (host: Awaited<ReturnType<typeof newGame>>["host"], id: string) => (await host.game(id))?.players.map((p) => p.name);

/** user.type would read "{" and "[" as keys; a paste goes in as it is. */
async function pasteList(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(await screen.findByRole("button", { name: /paste a list/i }));
  await user.click(screen.getByLabelText(/names, one per line/i));
  await user.paste(text);
}

describe("Pasting the roster", () => {
  for (const [device, wide] of [
    ["the laptop", true],
    ["the phone", false],
  ] as const) {
    it(`adds every name on the list at once, from ${device}`, async () => {
      screenWidth(wide);
      const { host, id, user } = await newGame();
      openApp(host, `/games/${id}`);

      await pasteList(user, "Ann\nBob\nCat\n");
      await user.click(screen.getByRole("button", { name: /add 3 players/i }));

      expect(await screen.findByRole("status")).toHaveTextContent(/added 3/i);
      expect(await names(host, id)).toEqual(["Ann", "Bob", "Cat"]);
    });
  }

  it("takes a list as it comes from an email or a spreadsheet: numbers, bullets, blank lines and extra columns", async () => {
    screenWidth(true);
    const { host, id, user } = await newGame();
    openApp(host, `/games/${id}`);

    await pasteList(user, "1. Ann Smith\n2) Bob Jones\n\n  • Cat Lee  \n- Dan Wu\nEve Park\tAccounting\tx104\n");
    await user.click(screen.getByRole("button", { name: /add 5 players/i }));

    await screen.findByRole("status");
    expect(await names(host, id)).toEqual(["Ann Smith", "Bob Jones", "Cat Lee", "Dan Wu", "Eve Park"]);
  });

  it("skips anyone already on the roster or listed twice, and says so", async () => {
    screenWidth(true);
    const { host, id, user } = await newGame();
    await host.command(id, { type: "AddPlayer", playerId: "ann", name: "Ann" });
    openApp(host, `/games/${id}`);

    await pasteList(user, "ann\nBob\nBob\nCat");
    await user.click(screen.getByRole("button", { name: /add 2 players/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/added 2.*skipped 2 already on the list/i);
    expect(await names(host, id)).toEqual(["Ann", "Bob", "Cat"]);
  });

  it("is offered only before the Game starts, and never to guests", async () => {
    screenWidth(false);
    const { origin, host, id } = await newGame();
    openApp(browser(origin), `/games/${id}`);
    await screen.findByText(/acme holiday party/i);
    expect(screen.queryByRole("button", { name: /paste a list/i })).not.toBeInTheDocument();

    for (const name of ["Ann", "Bob"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
    await host.command(id, { type: "StartGame" });
    openApp(host, `/games/${id}`);
    await screen.findByText(/up now/i);
    expect(screen.queryByRole("button", { name: /paste a list/i })).not.toBeInTheDocument();
  });

  it("puts nothing in until there's a name to add", async () => {
    screenWidth(true);
    const { host, id, user } = await newGame();
    openApp(host, `/games/${id}`);
    await pasteList(user, "\n  \n");
    expect(screen.getByRole("button", { name: /add 0 players/i })).toBeDisabled();
    expect(within(screen.getByRole("region", { name: /participants/i })).queryByRole("listitem")).not.toBeInTheDocument();
  });
});
