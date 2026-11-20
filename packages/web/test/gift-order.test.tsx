import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { browser, drawInOrder, openApp, startServer } from "./harness.js";

/** A big Game's worth of Gifts, in opening order: Dan's Mug, Bob's Socks, Eve's Mug, Ann's Apron and Cat's Candle. */
async function fiveGifts() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
  const opened = [
    ["Dan", "Mug"],
    ["Bob", "Socks"],
    ["Eve", "Mug"],
    ["Ann", "Apron"],
    ["Cat", "Candle"],
  ] as const;
  for (const [name] of opened) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
  await host.command(id, { type: "AddPlayer", playerId: "fay", name: "Fay" });
  await host.command(id, { type: "StartGame" });
  for (const [i, [name, gift]] of opened.entries()) await host.command(id, { type: "OpenGift", playerId: name.toLowerCase(), giftId: `g${i}`, name: gift });
  openApp(browser(server.origin), `/games/${id}`);
  await screen.findByRole("listitem", { name: "Candle" });
  return { user: userEvent.setup() };
}

/** Each Gift as "Mug (Dan)", top to bottom. */
const listed = () =>
  within(screen.getByRole("list", { name: /^gifts$/i }))
    .getAllByRole("listitem")
    .map((li) => `${li.getAttribute("aria-label")} (${/— (\w+)/.exec(li.textContent ?? "")?.[1]})`);

describe("Sorting the Gifts list", () => {
  it("is in opening order, or A–Z by Gift, or A–Z by holder to find what a friend has", async () => {
    const { user } = await fiveGifts();
    const sort = screen.getByRole("group", { name: /sort the gifts/i });
    expect(listed()).toEqual(["Mug (Dan)", "Socks (Bob)", "Mug (Eve)", "Apron (Ann)", "Candle (Cat)"]);

    await user.click(within(sort).getByRole("button", { name: /gift a–z/i }));
    expect(listed()).toEqual(["Apron (Ann)", "Candle (Cat)", "Mug (Dan)", "Mug (Eve)", "Socks (Bob)"]);

    await user.click(within(sort).getByRole("button", { name: /holder a–z/i }));
    expect(listed()).toEqual(["Apron (Ann)", "Socks (Bob)", "Candle (Cat)", "Mug (Dan)", "Mug (Eve)"]);

    await user.click(within(sort).getByRole("button", { name: /opened/i }));
    expect(listed()[0]).toBe("Mug (Dan)");
  });

  it("still puts Starred Gifts first", async () => {
    const { user } = await fiveGifts();
    await user.click(within(screen.getByRole("group", { name: /sort the gifts/i })).getByRole("button", { name: /holder a–z/i }));
    await user.click(screen.getByRole("button", { name: /star socks/i }));
    expect(listed()).toEqual(["Socks (Bob)", "Apron (Ann)", "Candle (Cat)", "Mug (Dan)", "Mug (Eve)"]);
  });
});
