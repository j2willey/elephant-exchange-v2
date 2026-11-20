import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { browser, drawInOrder, onTab, openApp, startServer } from "./harness.js";

/** A small, real JPEG, as a phone's photo picker would hand over. */
const jpeg = Uint8Array.from(
  atob(
    "/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAeACgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAQG/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AsAM2vAAAAAAAAAAf/9k=",
  ),
  (c) => c.charCodeAt(0),
);
const photo = () => new Blob([jpeg], { type: "image/jpeg" });

/** Ann opened a Mug and Bob a Lava lamp; three Posts are about the Mug, two of them with Photos. */
async function underway() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ name: "Troop swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3, rosterMode: "self" } });
  for (const name of ["Ann", "Bob", "Cat"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
  await host.command(id, { type: "StartGame" });
  await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Mug" });
  await host.command(id, { type: "OpenGift", playerId: "bob", giftId: "g2", name: "Lava lamp" });
  const gus = await server.signedIn("gus@example.com");
  await gus.post(id, { text: "Ann loves it", name: "Gus", giftId: "g1", photo: photo() });
  await gus.post(id, { text: "It's heated!", giftId: "g1" });
  await gus.post(id, { text: "Steal me", giftId: "g1", photo: photo() });
  return { ...server, host, gus, id, user: userEvent.setup() };
}

const gift = async (name: string) => within(await screen.findByRole("list", { name: /^gifts$/i })).findByRole("listitem", { name });

describe("A Gift's Posts on a phone", () => {
  it("shows just the newest Photo and caption, with a count to see them all", async () => {
    const { gus, id } = await underway();
    openApp(gus, `/games/${id}`);
    await onTab(/gifts/i);

    const mug = await gift("Mug");
    await waitFor(() => expect(within(mug).getAllByRole("img")).toHaveLength(1));
    expect(mug).toHaveTextContent(/steal me/i);
    expect(mug).not.toHaveTextContent(/ann loves it/i);
    expect(within(mug).getByRole("button", { name: /see all 3 posts about mug/i })).toHaveTextContent("3");
    expect(within(await gift("Lava lamp")).queryByRole("button", { name: /see all/i })).not.toBeInTheDocument();
  });

  it("opens them one at a time, newest first, to page through and close", async () => {
    const { gus, id, user } = await underway();
    openApp(gus, `/games/${id}`);
    await onTab(/gifts/i);

    await user.click(within(await gift("Mug")).getByRole("button", { name: /see all 3 posts about mug/i }));
    const viewer = screen.getByRole("dialog", { name: /mug/i });
    expect(viewer).toHaveTextContent(/1 of 3/);
    expect(viewer).toHaveTextContent(/steal me/i);
    expect(within(viewer).getByRole("img", { name: /photo from gus/i })).toBeInTheDocument();

    await user.click(within(viewer).getByRole("button", { name: /next/i }));
    expect(viewer).toHaveTextContent(/2 of 3/);
    expect(viewer).toHaveTextContent(/it's heated!/i);
    await user.click(within(viewer).getByRole("button", { name: /next/i }));
    expect(viewer).toHaveTextContent(/ann loves it/i);
    expect(within(viewer).getByRole("button", { name: /next/i })).toBeDisabled();
    await user.click(within(viewer).getByRole("button", { name: /previous/i }));
    expect(viewer).toHaveTextContent(/2 of 3/);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Adding a Photo right from a Gift", () => {
  it("posts it about that Gift, without picking the Gift", async () => {
    const { signedIn, id, user } = await underway();
    const dot = await signedIn("dot@example.com");
    openApp(dot, `/games/${id}`);
    await onTab(/gifts/i);

    await user.click(await within(await gift("Lava lamp")).findByRole("button", { name: /add a photo of lava lamp/i }));
    const form = within(await gift("Lava lamp")).getByRole("form", { name: /add a photo of lava lamp/i });
    expect(within(form).queryByLabelText(/about a gift/i)).not.toBeInTheDocument();
    await user.type(within(form).getByLabelText(/your name/i), "Dot");
    await user.upload(within(form).getByLabelText(/add a photo/i), new File([jpeg], "lamp.jpg", { type: "image/jpeg" }));
    await user.click(within(form).getByRole("button", { name: /^post$/i }));

    await waitFor(async () => expect(within(await gift("Lava lamp")).getByRole("img", { name: /photo from dot/i })).toBeInTheDocument());
    expect(within(await gift("Lava lamp")).queryByRole("form")).not.toBeInTheDocument();
    const posts = await dot.posts(id);
    expect(posts.find((p) => p.author === "Dot")).toMatchObject({ giftId: "g2" });
  });

  it("isn't offered to someone signed out, or once posting is paused", async () => {
    const { host, id, origin } = await underway();
    openApp(browser(origin), `/games/${id}`);
    await onTab(/gifts/i);
    expect(within(await gift("Mug")).queryByRole("button", { name: /add a photo/i })).not.toBeInTheDocument();

    await host.setModeration(id, "paused");
    expect(within(await gift("Mug")).queryByRole("button", { name: /add a photo/i })).not.toBeInTheDocument();
  });
});
