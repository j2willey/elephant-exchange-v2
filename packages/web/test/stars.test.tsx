import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { browser, drawInOrder, openApp, startServer } from "./harness.js";

/** A Game in play with Socks, Mug and Candle opened, in that order. */
async function giftsOnTheTable() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ activeSlots: 1, maxSteals: 3 });
  for (const name of ["Ann", "Bob", "Cat", "Dan"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
  await host.command(id, { type: "StartGame" });
  await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });
  await host.command(id, { type: "OpenGift", playerId: "bob", giftId: "g2", name: "Mug" });
  await host.command(id, { type: "OpenGift", playerId: "cat", giftId: "g3", name: "Candle" });
  return { ...server, host, id, user: userEvent.setup() };
}

const giftOrder = () =>
  within(screen.getByRole("list", { name: /gifts/i }))
    .getAllByRole("listitem")
    .map((li) => li.getAttribute("aria-label"));

const starButton = (gift: string) => screen.getByRole("button", { name: new RegExp(`star ${gift}`, "i") });

describe("Stars", () => {
  it("lets anyone following the Game Star a Gift, without signing in, and moves it to the top", async () => {
    const { origin, id, user } = await giftsOnTheTable();
    openApp(browser(origin), `/games/${id}`);
    await screen.findByRole("listitem", { name: "Candle" });
    expect(giftOrder()).toEqual(["Socks", "Mug", "Candle"]);

    await user.click(starButton("Candle"));

    expect(giftOrder()).toEqual(["Candle", "Socks", "Mug"]);
    expect(starButton("Candle")).toHaveAttribute("aria-pressed", "true");
    expect(starButton("Socks")).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps Starred Gifts in the order they were opened, and puts a Gift back when its Star is removed", async () => {
    const { origin, id, user } = await giftsOnTheTable();
    openApp(browser(origin), `/games/${id}`);
    await screen.findByRole("listitem", { name: "Candle" });

    await user.click(starButton("Candle"));
    await user.click(starButton("Mug"));
    expect(giftOrder()).toEqual(["Mug", "Candle", "Socks"]);

    await user.click(starButton("Mug"));
    expect(giftOrder()).toEqual(["Candle", "Socks", "Mug"]);
  });

  it("keeps Stars on this phone after a reload, and as the Game goes on", async () => {
    const { origin, host, id, user } = await giftsOnTheTable();
    const phone = browser(origin);
    const first = openApp(phone, `/games/${id}`);
    await screen.findByRole("listitem", { name: "Candle" });
    await user.click(starButton("Mug"));
    first.unmount();

    openApp(phone, `/games/${id}`);
    await screen.findByRole("listitem", { name: "Candle" });
    expect(giftOrder()).toEqual(["Mug", "Socks", "Candle"]);

    await host.command(id, { type: "OpenGift", playerId: "dan", giftId: "g4", name: "Scarf" });
    await screen.findByRole("listitem", { name: "Scarf" });
    expect(giftOrder()).toEqual(["Mug", "Socks", "Candle", "Scarf"]);
  });

  it("are personal: nobody else's list changes", async () => {
    const { origin, id, user } = await giftsOnTheTable();
    const mine = openApp(browser(origin), `/games/${id}`);
    await screen.findByRole("listitem", { name: "Candle" });
    await user.click(starButton("Candle"));
    mine.unmount();

    openApp(browser(origin), `/games/${id}`);

    await screen.findByRole("listitem", { name: "Candle" });
    expect(giftOrder()).toEqual(["Socks", "Mug", "Candle"]);
    expect(starButton("Candle")).toHaveAttribute("aria-pressed", "false");
  });

  it("aren't offered on the big screen, which the whole room shares", async () => {
    const { host, id } = await giftsOnTheTable();
    openApp(host, `/games/${id}/screen`);

    await waitFor(() => expect(screen.getByRole("listitem", { name: "Candle" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /star/i })).not.toBeInTheDocument();
  });
});
