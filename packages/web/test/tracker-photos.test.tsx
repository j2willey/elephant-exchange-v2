import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawInOrder, openApp, startServer } from "./harness.js";

const jpeg = Uint8Array.from(
  atob(
    "/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAeACgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAQG/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AsAM2vAAAAAAAAAAf/9k=",
  ),
  (c) => c.charCodeAt(0),
);

beforeEach(() =>
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width"), media: query, addEventListener() {}, removeEventListener() {} })),
);
afterEach(() => vi.unstubAllGlobals());

/** On the laptop console: a Mug with two Posts about it, one with a Photo, and a Lava lamp with none. */
async function underway() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ name: "Troop swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
  for (const name of ["Ann", "Bob", "Cat"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
  await host.command(id, { type: "StartGame" });
  await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Mug" });
  await host.command(id, { type: "OpenGift", playerId: "bob", giftId: "g2", name: "Lava lamp" });
  const gus = await server.signedIn("gus@example.com");
  await gus.post(id, { text: "Ann loves it", name: "Gus", giftId: "g1", photo: new Blob([jpeg], { type: "image/jpeg" }) });
  await gus.post(id, { text: "It's heated!", giftId: "g1" });
  openApp(host, `/games/${id}`);
  return { ...server, host, id, user: userEvent.setup() };
}

const tracked = async (name: string) =>
  within(await screen.findByRole("region", { name: /gift tracker/i })).findByRole("listitem", { name });

describe("Photos in the laptop's Gift Tracker", () => {
  it("shows each Gift's newest Photo and how many Posts are about it", async () => {
    await underway();
    const mug = await tracked("Mug");
    expect(await within(mug).findByRole("img", { name: /photo from gus/i })).toBeInTheDocument();
    expect(within(mug).getByRole("button", { name: /see all 2 posts about mug/i })).toHaveTextContent("2");
    expect(within(await tracked("Lava lamp")).queryByRole("button", { name: /posts? about/i })).not.toBeInTheDocument();
  });

  it("opens them one at a time", async () => {
    const { user } = await underway();
    await user.click(await within(await tracked("Mug")).findByRole("button", { name: /see all 2 posts about mug/i }));
    const viewer = screen.getByRole("dialog", { name: /mug/i });
    expect(viewer).toHaveTextContent(/1 of 2/);
    expect(viewer).toHaveTextContent(/it's heated!/i);
  });
});
