import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { clock, drawInOrder, openApp, startServer } from "./harness.js";

beforeEach(() => localStorage.clear());

/** A Game under way, with Gus following on his phone and Dot posting from hers. */
async function underway() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ name: "Troop swap", options: { ...RECOMMENDED_OPTIONS, rosterMode: "self" } });
  await host.setGameOptions(id, { postsPerMinute: 0 }); // Dot posts more quickly than the Feed limit allows
  for (const name of ["Ann", "Bob"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
  await host.command(id, { type: "StartGame" });
  const gus = await server.signedIn("gus@example.com");
  const dot = await server.signedIn("dot@example.com");
  return { ...server, host, gus, dot, id, user: userEvent.setup() };
}

const feedTab = () => screen.findByRole("tab", { name: /chat/i });

describe("New Posts while a guest is on the Gifts", () => {
  it("show as a count on the Feed tab that rises, and clears once they open the Feed", async () => {
    const { gus, dot, id, user } = await underway();
    openApp(gus, `/games/${id}`);
    expect(await feedTab()).toHaveAccessibleName("Chat"); // nothing new yet

    await dot.post(id, { text: "Hi all", name: "Dot" });
    await waitFor(async () => expect(await feedTab()).toHaveAccessibleName("Chat, 1 new"));
    await dot.post(id, { text: "Look at Bob!", name: "Dot" });
    await waitFor(async () => expect(await feedTab()).toHaveAccessibleName("Chat, 2 new"));
    expect((await feedTab()).querySelector(".tab-badge")).toHaveTextContent("2");

    await user.click(await feedTab());
    await waitFor(async () => expect((await feedTab()).querySelector(".tab-badge")).toBeNull());
  });

  it("doesn't count the guest's own Posts, and remembers what they've seen after a reload", async () => {
    const { gus, dot, id, user } = await underway();
    await dot.post(id, { text: "Hi all", name: "Dot" });
    openApp(gus, `/games/${id}`);
    await waitFor(async () => expect(await feedTab()).toHaveAccessibleName("Chat, 1 new"));
    await user.click(await feedTab());
    clock.advance(10);
    await gus.post(id, { text: "Me too", name: "Gus" });

    cleanup();
    openApp(gus, `/games/${id}`);
    clock.advance(10);
    await dot.post(id, { text: "Welcome back", name: "Dot" });
    // Only Dot's new one: not the one already seen before the reload, nor Gus's own.
    await waitFor(async () => expect(await feedTab()).toHaveAccessibleName("Chat, 1 new"));
  });

  it("shows 9+ once there are more than nine", async () => {
    const { gus, dot, id } = await underway();
    for (let n = 1; n <= 11; n++) await dot.post(id, { text: `Post ${n}`, name: "Dot" });
    openApp(gus, `/games/${id}`);
    await waitFor(async () => expect((await feedTab()).querySelector(".tab-badge")).toHaveTextContent("9+"));
    expect(await feedTab()).toHaveAccessibleName("Chat, 11 new");
  });
});
