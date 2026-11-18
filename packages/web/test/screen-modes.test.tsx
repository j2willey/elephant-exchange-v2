import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browser, drawInOrder, openApp, startServer } from "./harness.js";

/** A Game under way: Ann opened Socks, Bob stole it, and its big screen is open in another browser. */
async function underway() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ activeSlots: 1, maxSteals: 2 }, "Acme Holiday Party");
  for (const name of ["Ann", "Bob", "Cat"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
  await host.command(id, { type: "StartGame" });
  await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });
  await host.command(id, { type: "Steal", playerId: "bob", giftId: "g1" });
  return { ...server, host, id };
}

const onTheScreen = async (origin: string, id: string) => {
  openApp(browser(origin), `/games/${id}/screen`);
  await screen.findByRole("banner");
};

describe("What the big screen shows, as the Host switches it", () => {
  it("shows the rules, with this Game's Steal limit", async () => {
    const { origin, host, id } = await underway();
    await onTheScreen(origin, id);

    await host.setScreen(id, "rules");

    const rules = await screen.findByRole("region", { name: /how it works/i });
    expect(rules).toHaveTextContent(/frozen after 2 steals/i);
    expect(rules).toHaveTextContent(/no take-backs/i);
    expect(screen.queryByRole("list", { name: /^gifts$/i })).not.toBeInTheDocument();
  });

  it("shows the join code large, with its link", async () => {
    const { origin, host, id } = await underway();
    await onTheScreen(origin, id);

    await host.setScreen(id, "qr");

    await waitFor(() => expect(screen.getByRole("region", { name: /join/i })).toHaveClass("join-big"));
    const join = screen.getByRole("region", { name: /join/i });
    expect(within(join).getByRole("img", { name: /qr code to join/i })).toBeInTheDocument();
    expect(join).toHaveTextContent(new RegExp(`/games/${id}`));
  });

  it("shows a catalog card for each Gift, with its holder and Steals", async () => {
    const { origin, host, id } = await underway();
    await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g2", name: "Mug" });
    await onTheScreen(origin, id);

    await host.setScreen(id, "catalog");

    const catalog = await screen.findByRole("list", { name: /catalog/i });
    const socks = within(catalog).getByRole("listitem", { name: "Socks" });
    expect(socks).toHaveTextContent(/bob/i);
    expect(socks).toHaveTextContent(/1\/2 steals/i);
    expect(within(catalog).getByRole("listitem", { name: "Mug" })).toHaveTextContent(/ann/i);
  });

  it("goes back to the Gift board, keeping the banner throughout", async () => {
    const { origin, host, id } = await underway();
    await host.setScreen(id, "rules");
    await onTheScreen(origin, id);
    await screen.findByRole("region", { name: /how it works/i });

    await host.setScreen(id, "gifts");

    expect(await screen.findByRole("list", { name: /^gifts$/i })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveTextContent(/acme holiday party/i);
  });
});

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

describe("Switching the big screen from the Host console", () => {
  for (const [device, wide] of [
    ["a laptop", true],
    ["a phone", false],
  ] as const) {
    it(`works from ${device}, and shows which is on`, async () => {
      screenWidth(wide);
      const { host, id } = await underway();
      const user = userEvent.setup();
      openApp(host, `/games/${id}`);

      const switcher = await screen.findByRole("group", { name: /scoreboard shows/i });
      expect(within(switcher).getByRole("button", { name: /gifts/i })).toHaveAttribute("aria-pressed", "true");

      await user.click(within(switcher).getByRole("button", { name: /rules/i }));

      await waitFor(() => expect(within(switcher).getByRole("button", { name: /rules/i })).toHaveAttribute("aria-pressed", "true"));
      expect(within(switcher).getByRole("button", { name: /gifts/i })).toHaveAttribute("aria-pressed", "false");
      expect((await host.game(id))?.screen).toBe("rules");
    });
  }

  it("isn't offered to guests", async () => {
    const { origin, id } = await underway();
    openApp(browser(origin), `/games/${id}`);
    await screen.findAllByText(/socks/i);
    expect(screen.queryByRole("group", { name: /scoreboard shows/i })).not.toBeInTheDocument();
  });
});
