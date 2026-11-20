import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { drawInOrder, onTab, openApp, startServer } from "./harness.js";

function screenWidth(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide && query.includes("min-width"), media: query, addEventListener() {}, removeEventListener() {} }));
}
afterEach(() => vi.unstubAllGlobals());

/** A Mug and a Lava lamp opened, and a Post about the Mug. */
async function underway() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ activeSlots: 1, maxSteals: 3 }, "Troop swap");
  for (const name of ["Ann", "Bob", "Cat"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
  await host.command(id, { type: "StartGame" });
  await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Mug" });
  await host.command(id, { type: "OpenGift", playerId: "bob", giftId: "g2", name: "Lava lamp" });
  const gus = await server.signedIn("gus@example.com");
  await gus.post(id, { text: "Steal it!", name: "Gus", giftId: "g1" });
  return { ...server, host, gus, id, user: userEvent.setup() };
}

const aboutMug = async () =>
  within(await within(await screen.findByRole("feed", { name: /feed/i })).findByRole("article", { name: /gus/i })).findByRole("button", {
    name: /about mug/i,
  });

describe("The Gift a Post is about, in the Feed", () => {
  it("takes a phone to that Gift in the Gifts tab", async () => {
    screenWidth(false);
    const { gus, id, user } = await underway();
    openApp(gus, `/games/${id}`);
    await onTab(/^feed/i);

    await user.click(await aboutMug());

    expect(screen.getByRole("tab", { name: /gifts/i })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByRole("listitem", { name: "Mug" })).toHaveFocus());
  });

  it("takes the Host's laptop to that Gift in the Gift Tracker", async () => {
    screenWidth(true);
    const { host, id, user } = await underway();
    openApp(host, `/games/${id}`);

    await user.click(await aboutMug());

    const tracker = screen.getByRole("region", { name: /gift tracker/i });
    await waitFor(() => expect(within(tracker).getByRole("listitem", { name: "Mug" })).toHaveFocus());
  });
});
