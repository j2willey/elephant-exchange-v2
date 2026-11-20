import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { drawInOrder, onTab, openApp, startServer } from "./harness.js";

/** A small, real JPEG, as a phone's photo picker would hand over. */
const jpeg = Uint8Array.from(
  atob(
    "/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAeACgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAQG/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AsAM2vAAAAAAAAAAf/9k=",
  ),
  (c) => c.charCodeAt(0),
);
const photoFile = (name = "IMG_0001.jpg") => new File([jpeg], name, { type: "image/jpeg" });

async function underway() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ name: "Troop swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3, rosterMode: "self" } });
  for (const name of ["Ann", "Bob"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
  await host.command(id, { type: "StartGame" });
  await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Mug" });
  const guest = await server.signedIn("gus@example.com");
  openApp(guest, `/games/${id}`);
  const user = userEvent.setup();
  await onTab(/^post/i);
  const form = await screen.findByRole("form", { name: /post to the feed/i });
  return { ...server, id, user, form };
}

/** The image a Post shows, once it's in the Feed. */
const photoInFeed = async (author: string) =>
  (await onTab(/feed/i), within(await screen.findByRole("feed", { name: /feed/i })).findByRole("img", { name: new RegExp(`photo from ${author}`, "i") }));

describe("Photos in Posts", () => {
  it("lets someone add a Photo to a Post, which everyone sees in the Feed", async () => {
    const { origin, user, form } = await underway();

    await user.type(within(form).getByLabelText(/your name/i), "Gus");
    await user.type(within(form).getByLabelText(/what's happening/i), "Look!");
    await user.upload(within(form).getByLabelText(/add a photo/i), photoFile());
    await user.click(within(form).getByRole("button", { name: /^post$/i }));

    const img = await photoInFeed("Gus");
    expect(img.closest("article")).toHaveTextContent(/look!/i);
    // It's the server's copy, which anyone following can load.
    const res = await fetch(new URL(img.getAttribute("src")!, origin));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(img).toHaveAttribute("width", "40");
    expect(img).toHaveAttribute("height", "30");
  });

  it("can be just a Photo, with no words", async () => {
    const { user, form } = await underway();
    await user.type(within(form).getByLabelText(/your name/i), "Gus");
    const postButton = within(form).getByRole("button", { name: /^post$/i });
    expect(postButton).toBeDisabled();

    await user.upload(within(form).getByLabelText(/add a photo/i), photoFile());
    expect(postButton).toBeEnabled();
    await user.click(postButton);

    await photoInFeed("Gus");
  });

  it("shows a Photo about a Gift under that Gift too", async () => {
    const { user, form } = await underway();
    await user.type(within(form).getByLabelText(/your name/i), "Gus");
    await user.upload(within(form).getByLabelText(/add a photo/i), photoFile());
    await user.selectOptions(within(form).getByLabelText(/about a gift/i), "Mug (Ann)");
    await user.click(within(form).getByRole("button", { name: /^post$/i }));
    await photoInFeed("Gus");
    await onTab(/gifts/i);

    await waitFor(() =>
      expect(within(screen.getByRole("listitem", { name: "Mug" })).getByRole("img", { name: /photo from gus/i })).toBeInTheDocument(),
    );
  });

  it("can be taken off before posting", async () => {
    const { user, form } = await underway();
    await user.upload(within(form).getByLabelText(/add a photo/i), photoFile("IMG_0002.jpg"));
    expect(within(form).getByRole("img", { name: /photo to post/i })).toBeInTheDocument();

    await user.click(within(form).getByRole("button", { name: /remove photo/i }));

    expect(within(form).queryByRole("img", { name: /photo to post/i })).not.toBeInTheDocument();
    expect(within(form).getByRole("button", { name: /^post$/i })).toBeDisabled();
  });

  it("says so when the file isn't a photo the server can use", async () => {
    const { user, form } = await underway();
    await user.type(within(form).getByLabelText(/your name/i), "Gus");
    await user.upload(within(form).getByLabelText(/add a photo/i), new File(["not really"], "notes.jpg", { type: "image/jpeg" }));
    await user.click(within(form).getByRole("button", { name: /^post$/i }));

    expect(await within(form).findByRole("alert")).toHaveTextContent(/doesn't look like a photo/i);
  });

  it("won't send a full-size photo this phone couldn't shrink, and says what to do instead", async () => {
    const { id, signedIn, user, form } = await underway();
    await user.type(within(form).getByLabelText(/your name/i), "Gus");
    // The test browser can't decode images, as some phone's browser might not: 3 MB stays 3 MB.
    await user.upload(within(form).getByLabelText(/add a photo/i), new File([new Uint8Array(3_000_000)], "IMG_0002.HEIC", { type: "image/heic" }));
    await user.click(within(form).getByRole("button", { name: /^post$/i }));

    expect(await within(form).findByRole("alert")).toHaveTextContent(/couldn't be made smaller on this phone.*screenshot/i);
    expect(await (await signedIn("host@example.com")).posts(id)).toEqual([]);
  });
});

describe("The album", () => {
  it("is offered to the Host, with word of when the Photos go", async () => {
    const server = await startServer({ draw: drawInOrder });
    const host = await server.signedIn("host@example.com");
    const id = await host.createGame({ options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    openApp(host, `/games/${id}/settings`);

    const link = await screen.findByRole("link", { name: /download all the photos/i });
    expect(link).toHaveAttribute("href", `/api/games/${id}/album.zip`);
    expect(screen.getByText(/deleted 60 days after the game's last move/i)).toBeInTheDocument();
  });

  it("isn't offered to anyone else", async () => {
    const { form } = await underway();
    expect(form).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /download all the photos/i })).not.toBeInTheDocument();
  });
});
