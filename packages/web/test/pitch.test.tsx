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
    await user.type(within(screen.getByRole("form", { name: /your pitch for fruitcake/i })).getByLabelText(/the pitch/i), "Grandma's recipe. Probably.");
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
    await gus.setPitch(id, "cake", { text: "Grandma's recipe." });
    await host.command(id, { type: "Steal", playerId: halId, giftId: "cake" });
    openApp(hal, `/games/${id}`);
    await onTab(/gifts/i);

    await user.click(await screen.findByRole("button", { name: /🎤 pitch it$/i }));
    await user.type(within(screen.getByRole("form", { name: /your pitch for fruitcake/i })).getByLabelText(/the pitch/i), "It's a doorstop.");
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
    await user.type(within(screen.getByRole("form", { name: /cat's pitch for fruitcake/i })).getByLabelText(/the pitch/i), "Vintage!");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await pitchList()).toHaveTextContent(/cat: vintage!/i);
  });

  it("shows the newest part on the TV's catalog", async () => {
    const { host, gus, id } = await underway();
    await gus.setPitch(id, "cake", { text: "Grandma's recipe." });
    await host.setScreen(id, "catalog");
    openApp(host, `/games/${id}/screen`);

    const card = await screen.findByRole("listitem", { name: /fruitcake/i });
    await waitFor(() => expect(card).toHaveTextContent(/“grandma's recipe\.” — gus/i));
  });
});

describe("A pitch's tagline, and pitching it again", () => {
  it("shows the tagline in bold above the pitch, under the Gift and in the Feed", async () => {
    const { gus, id, user } = await underway();
    openApp(gus, `/games/${id}`);
    await onTab(/gifts/i);
    await user.click(await screen.findByRole("button", { name: /🎤 pitch it$/i }));
    const form = screen.getByRole("form", { name: /your pitch for fruitcake/i });
    await user.type(within(form).getByLabelText(/tagline/i), "A TRUE HEIRLOOM");
    await user.type(within(form).getByLabelText(/the pitch/i), "Grandma's recipe.");
    await user.click(within(form).getByRole("button", { name: /^save$/i }));

    const list = await pitchList();
    await waitFor(() => expect(list.querySelector(".pitch-tagline")).toHaveTextContent("A TRUE HEIRLOOM"));
    expect(list).toHaveTextContent(/gus: grandma's recipe\./i);
  });

  it("lets the holder send it to the top of the Feed again, then says how long until the next time", async () => {
    const { gus, id, user } = await underway();
    await gus.setPitch(id, "cake", { tagline: "A TRUE HEIRLOOM", text: "Grandma's recipe." });
    openApp(gus, `/games/${id}`);
    await onTab(/gifts/i);

    // Just written: the wait has only begun.
    expect(await within(await pitchList()).findByText(/again in 5 min/i)).toBeInTheDocument();
    expect(await gus.repitch(id, "cake")).toEqual({ wait: 300 });
  });

  it("lets the Host set the Feed limits in Settings", async () => {
    const { host, id, user } = await underway();
    openApp(host, `/games/${id}/settings`);
    const perMinute = await screen.findByLabelText(/most posts a guest can make in a minute/i);
    expect(perMinute).toHaveValue(3);
    expect(screen.getByLabelText(/minutes before a holder can pitch their gift again/i)).toHaveValue(5);

    await user.clear(perMinute);
    await user.type(perMinute, "3");
    await user.clear(screen.getByLabelText(/minutes before a holder can pitch/i));
    await user.type(screen.getByLabelText(/minutes before a holder can pitch/i), "10");
    await user.click(screen.getByRole("button", { name: /save chat limits/i }));

    await screen.findByText(/^saved\.$/i);
    expect(await host.game(id)).toMatchObject({ postsPerMinute: 3, repitchMinutes: 10 });
  });
});
