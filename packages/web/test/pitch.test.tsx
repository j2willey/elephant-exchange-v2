import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawInOrder, onTab, openApp, startServer } from "./harness.js";

function screenWidth(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide && query.includes("min-width"), media: query, addEventListener() {}, removeEventListener() {} }));
}
beforeEach(() => screenWidth(false));
afterEach(() => vi.unstubAllGlobals());

/** Gus and Hal joined on their phones, Cat was typed in; Gus opened the Fruitcake and Hal is up. */
async function underway() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ name: "Office swap", options: { ...RECOMMENDED_OPTIONS, rosterMode: "self" } });
  const gus = await server.signedIn("gus@example.com");
  const joined = async (who: typeof gus, name: string) => {
    const r = await who.join(id, name);
    if (!r.ok) throw new Error(r.message);
    return r.me.playerId;
  };
  const gusId = await joined(gus, "Gus");
  const hal = await server.signedIn("hal@example.com");
  const halId = await joined(hal, "Hal");
  await host.command(id, { type: "AddPlayer", playerId: "cat", name: "Cat" });
  await host.command(id, { type: "StartGame" });
  await host.command(id, { type: "OpenGift", playerId: gusId, giftId: "cake", name: "Fruitcake" });
  return { ...server, host, gus, hal, gusId, halId, id, user: userEvent.setup() };
}

const pitchList = () => screen.findByRole("list", { name: /pitch for fruitcake/i });

describe("A Gift's pitch, on the phones", () => {
  it("lets the holder pitch their Gift from the Gifts tab, and everyone sees it", async () => {
    const { gus, hal, id, user } = await underway();
    openApp(gus, `/games/${id}`);
    await onTab(/gifts/i);

    await user.click(await screen.findByRole("button", { name: /🎤 pitch it$/i }));
    await user.type(screen.getByRole("textbox", { name: /your pitch for fruitcake/i }), "Grandma's recipe. Probably.");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await pitchList()).toHaveTextContent(/gus: grandma's recipe\. probably\./i);
    const seen = (await hal.posts(id)).filter((p) => p.pitchFor !== null);
    expect(seen.map((p) => p.text)).toEqual(["Grandma's recipe. Probably."]);
  });

  it("isn't offered to someone who doesn't hold the Gift", async () => {
    const { hal, id } = await underway();
    openApp(hal, `/games/${id}`);
    await onTab(/gifts/i);
    await screen.findByRole("listitem", { name: /fruitcake/i });
    expect(screen.queryByRole("button", { name: /pitch it/i })).not.toBeInTheDocument();
  });

  it("builds up as the Gift is stolen, newest part on top, each holder editing only their own", async () => {
    const { host, gus, hal, halId, id, user } = await underway();
    await gus.setPitch(id, "cake", "Grandma's recipe.");
    await host.command(id, { type: "Steal", playerId: halId, giftId: "cake" });
    openApp(hal, `/games/${id}`);
    await onTab(/gifts/i);

    await user.click(await screen.findByRole("button", { name: /🎤 pitch it$/i }));
    await user.type(screen.getByRole("textbox", { name: /your pitch for fruitcake/i }), "It's a doorstop.");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(async () => expect(within(await pitchList()).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringMatching(/^🎤 Hal: It's a doorstop\./),
      expect.stringMatching(/^🎤 Gus: Grandma's recipe\./),
    ]));
    const list = await pitchList();
    expect(within(list).getByRole("button", { name: /edit hal's pitch/i })).toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: /edit gus's pitch/i })).not.toBeInTheDocument();
  });
});

describe("A Gift's pitch, for the Host", () => {
  it("lets the Host pitch for a holder without a phone, from the laptop's Gift Tracker", async () => {
    screenWidth(true);
    const { host, halId, id, user } = await underway();
    await host.command(id, { type: "OpenGift", playerId: halId, giftId: "socks", name: "Socks" });
    await host.command(id, { type: "Steal", playerId: "cat", giftId: "cake" });
    openApp(host, `/games/${id}`);
    await onTab(/gift tracker|gifts/i);

    await user.click(await screen.findByRole("button", { name: /pitch it for cat/i }));
    await user.type(screen.getByRole("textbox", { name: /cat's pitch for fruitcake/i }), "Vintage!");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await pitchList()).toHaveTextContent(/cat: vintage!/i);
  });

  it("shows the newest part on the TV's catalog", async () => {
    const { host, gus, id } = await underway();
    await gus.setPitch(id, "cake", "Grandma's recipe.");
    await host.setScreen(id, "catalog");
    openApp(host, `/games/${id}/screen`);

    const card = await screen.findByRole("listitem", { name: /fruitcake/i });
    await waitFor(() => expect(card).toHaveTextContent(/“grandma's recipe\.” — gus/i));
  });
});
