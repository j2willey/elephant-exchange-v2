import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { drawInOrder, onTab, openApp, startServer } from "./harness.js";

/** Ann opened a Mug; Gus posted without saying which Gift. */
async function underway() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ name: "Troop swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
  for (const name of ["Ann", "Bob"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
  await host.command(id, { type: "StartGame" });
  await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Mug" });
  const gus = await server.signedIn("gus@example.com");
  await gus.post(id, { text: "Ann's face!", name: "Gus" });
  return { ...server, host, gus, id, user: userEvent.setup() };
}

const gusPost = async () => within(await screen.findByRole("feed", { name: /chat/i })).findByRole("article", { name: /gus/i });

describe("Attaching a Post to a Gift from the Feed", () => {
  it("lets the poster pick the Gift afterwards, and it then shows under that Gift", async () => {
    const { gus, id, user } = await underway();
    openApp(gus, `/games/${id}`);
    await onTab(/^chat/i);

    await user.click(await within(await gusPost()).findByRole("button", { name: /attach to a gift/i }));
    const form = within(await gusPost()).getByRole("form", { name: /which gift/i });
    await user.selectOptions(within(form).getByLabelText(/which gift/i), "Mug (Ann)");
    await user.click(within(form).getByRole("button", { name: /save/i }));

    await waitFor(async () => expect(await gusPost()).toHaveTextContent(/about mug/i));
    expect(within(await gusPost()).getByRole("button", { name: /change gift/i })).toBeInTheDocument();
    await onTab(/gifts/i);
    await waitFor(() => expect(screen.getByRole("listitem", { name: "Mug" })).toHaveTextContent(/ann's face!/i));
  });

  it("lets the Host attach anyone's Post", async () => {
    const { host, id, user } = await underway();
    openApp(host, `/games/${id}`);

    await user.click(await within(await gusPost()).findByRole("button", { name: /attach to a gift/i }));
    const form = within(await gusPost()).getByRole("form", { name: /which gift/i });
    await user.selectOptions(within(form).getByLabelText(/which gift/i), "Mug (Ann)");
    await user.click(within(form).getByRole("button", { name: /save/i }));
    await waitFor(async () => expect((await host.posts(id))[0]!.giftId).toBe("g1"));
  });

  it("isn't offered on someone else's Post", async () => {
    const { signedIn, id } = await underway();
    openApp(await signedIn("dot@example.com"), `/games/${id}`);
    await onTab(/^chat/i);
    await gusPost();
    expect(screen.queryByRole("button", { name: /attach to a gift/i })).not.toBeInTheDocument();
  });
});

describe("Picking the Gift, in a big Game with two of the same", () => {
  /** Two Mugs, held by Ann and Bob; Cat is still to go. */
  async function twoMugs() {
    const server = await startServer({ draw: drawInOrder });
    const host = await server.signedIn("host@example.com");
    const id = await host.createGame({ name: "Big swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    for (const name of ["Bob", "Ann", "Cat"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
    await host.command(id, { type: "StartGame" });
    await host.command(id, { type: "OpenGift", playerId: "bob", giftId: "g1", name: "Mug" });
    await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g2", name: "Mug" });
    await host.command(id, { type: "OpenGift", playerId: "cat", giftId: "g3", name: "Candle" });
    const gus = await server.signedIn("gus@example.com");
    return { ...server, gus, id, user: userEvent.setup() };
  }
  const choices = (select: HTMLElement) => within(select).getAllByRole("option").map((o) => o.textContent);

  it("says who holds each, A–Z by Gift, or by holder at a tap", async () => {
    const { gus, id, user } = await twoMugs();
    openApp(gus, `/games/${id}`);
    await onTab(/^post/i);
    const form = await screen.findByRole("form", { name: /post to the chat/i });
    const select = within(form).getByLabelText(/about a gift/i);

    expect(choices(select)).toEqual(["No, just the Chat", "Candle (Cat)", "Mug (Ann)", "Mug (Bob)"]);
    await user.click(within(form).getByRole("button", { name: /sort by holder/i }));
    expect(choices(select)).toEqual(["No, just the Chat", "Ann: Mug", "Bob: Mug", "Cat: Candle"]);

    // The one picked is the one posted about: Bob's Mug, not Ann's.
    await user.selectOptions(select, "Bob: Mug");
    await user.type(within(form).getByLabelText(/what's happening/i), "Bob loves it");
    await user.type(within(form).getByLabelText(/your name/i), "Gus");
    await user.click(within(form).getByRole("button", { name: /^post$/i }));
    await waitFor(async () => expect((await gus.posts(id)).map((p) => p.giftId)).toEqual(["g1"]));
  });
});

describe("Changing your mind about a Post", () => {
  it("clears what was written, the Photo and the Gift, without posting", async () => {
    const { gus, id, user } = await underway();
    openApp(gus, `/games/${id}`);
    await onTab(/^post/i);
    const form = await screen.findByRole("form", { name: /post to the chat/i });
    expect(within(form).queryByRole("button", { name: /^clear$/i })).not.toBeInTheDocument(); // nothing to clear yet

    await user.type(within(form).getByLabelText(/what's happening/i), "Never mind");
    await user.selectOptions(within(form).getByLabelText(/about a gift/i), "Mug (Ann)");
    await user.click(within(form).getByRole("button", { name: /^clear$/i }));

    expect(within(form).getByLabelText(/what's happening/i)).toHaveValue("");
    expect(within(form).getByLabelText(/about a gift/i)).toHaveValue("");
    expect(within(form).queryByRole("button", { name: /^clear$/i })).not.toBeInTheDocument();
    expect(await gus.posts(id)).toHaveLength(1); // only the one from before
  });
});
