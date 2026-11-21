import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browser, drawInOrder, openApp, startServer } from "./harness.js";

const jpeg = Uint8Array.from(
  atob(
    "/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAeACgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAQG/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AsAM2vAAAAAAAAAAf/9k=",
  ),
  (c) => c.charCodeAt(0),
);

/**
 * A party that's over: Ann opened the Fish, Bob stole it twice over; Gus posted a Photo of it, a line everyone
 * laughed at and a dull one; Bob posted one the Host hid; Ann pitched the Fish with a tagline.
 */
async function partyOver() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ name: "Office swap", options: { ...RECOMMENDED_OPTIONS, rosterMode: "self", maxSteals: 3 } });
  const ann = await server.signedIn("ann@example.com");
  const bob = await server.signedIn("bob@example.com");
  for (const [who, name] of [[ann, "Ann"], [bob, "Bob"]] as const) {
    const joined = await who.join(id, name);
    if (!joined.ok) throw new Error(joined.message);
  }
  const players = (await host.game(id))!.players;
  const [annId, bobId] = [players.find((p) => p.name === "Ann")!.id, players.find((p) => p.name === "Bob")!.id];
  await host.command(id, { type: "StartGame" });
  await host.command(id, { type: "OpenGift", playerId: annId, giftId: "fish", name: "Singing fish" });
  await ann.setPitch(id, "fish", { tagline: "IT SINGS", text: "Batteries included." });
  await host.command(id, { type: "Steal", playerId: bobId, giftId: "fish" });

  const gus = await server.signedIn("gus@example.com");
  await gus.post(id, { text: "Bob's face", name: "Gus", photo: new File([jpeg], "face.jpg", { type: "image/jpeg" }) });
  await gus.post(id, { text: "Nobody wants the fish. Everybody wants the fish.", name: "Gus" });
  await gus.post(id, { text: "ok", name: "Gus" });
  await bob.post(id, { text: "Something the Host hid" }); // Gus has had his 3 Posts this minute
  const posts = await host.posts(id);
  const byText = (text: string) => posts.find((p) => p.text === text)!.id;
  await ann.react(id, byText("Nobody wants the fish. Everybody wants the fish."), "😂", true);
  await bob.react(id, byText("Nobody wants the fish. Everybody wants the fish."), "😂", true);
  await host.setPostStatus(id, byText("Something the Host hid"), "hidden");
  await host.command(id, { type: "EndGame" });
  return { ...server, host, id };
}

const allHighlights = async () =>
  within(await screen.findByRole("list", { name: /all highlights/i }))
    .getAllByRole("listitem")
    .map((li) => li.textContent);

describe("The night's highlights, on the big screen", () => {
  it("are what everyone saw: the Photos, the funniest Posts first, Pitch taglines and the most-stolen Gift", async () => {
    const { host, id, origin } = await partyOver();
    await host.setScreen(id, "highlights");
    openApp(browser(origin), `/games/${id}/screen`);

    await waitFor(async () => expect(await allHighlights()).toContain("Photo from Gus: Bob's face"));
    const items = await allHighlights();
    const quotes = items.filter((t) => t?.startsWith("Gus: “"));
    expect(quotes[0]).toBe("Gus: “Nobody wants the fish. Everybody wants the fish.”"); // the most laughed at first
    expect(items).toContain("Ann's pitch for Singing fish: IT SINGS");
    expect(items).toContain("Singing fish: Stolen 1 time, the most of the night");
    expect(items.join(" ")).not.toMatch(/something the host hid/i);
  });

  it("show tiles filling the screen, starting at once", async () => {
    const { host, id, origin } = await partyOver();
    await host.setScreen(id, "highlights");
    const { container } = openApp(browser(origin), `/games/${id}/screen`);

    await waitFor(() => expect(container.querySelectorAll(".hl-tile").length).toBeGreaterThan(0));
  });

  it("are offered on the Host's switch only once the Game is over", async () => {
    const server = await startServer({ draw: drawInOrder });
    const host = await server.signedIn("host@example.com");
    const id = await host.createGame({ name: "Office swap", options: { ...RECOMMENDED_OPTIONS } });
    openApp(host, `/games/${id}`);
    const modes = await screen.findByRole("group", { name: /scoreboard shows/i });
    expect(within(modes).queryByRole("button", { name: /highlights/i })).not.toBeInTheDocument();

    cleanup();
    const over = await partyOver();
    openApp(over.host, `/games/${over.id}`);
    const after = await screen.findByRole("group", { name: /scoreboard shows/i });
    expect(within(after).getByRole("button", { name: /highlights/i })).toBeInTheDocument();
  });

  it("say so when nobody posted", async () => {
    const server = await startServer({ draw: drawInOrder });
    const host = await server.signedIn("host@example.com");
    const id = await host.createGame({ name: "Quiet one", options: { ...RECOMMENDED_OPTIONS } });
    await host.command(id, { type: "EndGame" });
    await host.setScreen(id, "highlights");
    openApp(browser(server.origin), `/games/${id}/screen`);
    expect(await screen.findByText(/nobody posted this time/i)).toBeInTheDocument();
  });
});

describe("The night's highlights page, for everyone after the party", () => {
  afterEach(() => Object.assign(navigator, { share: undefined }));

  it("lays out the Photos, the funniest Posts, the pitches and the facts, for anyone with the link", async () => {
    const { id, origin } = await partyOver();
    openApp(browser(origin), `/games/${id}/highlights`);

    expect(await screen.findByText(/the night's highlights/i)).toBeInTheDocument();
    const photos = await screen.findByRole("region", { name: /photos/i });
    expect(await within(photos).findByRole("img", { name: /bob's face/i })).toBeInTheDocument();
    const quotes = within(screen.getByRole("region", { name: /funniest posts/i })).getAllByRole("listitem");
    expect(quotes[0]).toHaveTextContent("Nobody wants the fish. Everybody wants the fish."); // the most laughed at first
    expect(screen.getByRole("region", { name: /the pitches/i })).toHaveTextContent(/IT SINGS.*Ann's pitch for Singing fish/);
    expect(screen.getByRole("region", { name: /the night in numbers/i })).toHaveTextContent(/stolen 1 time/i);
    expect(screen.getByRole("main")).not.toHaveTextContent(/something the host hid/i);
  });

  it("are linked from a guest's phone and the Host's console once the Game is over", async () => {
    const { host, id, origin } = await partyOver();
    openApp(browser(origin), `/games/${id}`);
    expect(await screen.findByRole("link", { name: /the night's highlights/i })).toHaveAttribute("href", `/games/${id}/highlights`);

    cleanup();
    openApp(host, `/games/${id}`);
    expect(await screen.findByRole("link", { name: /the night's highlights/i })).toHaveAttribute("href", `/games/${id}/highlights`);
  });

  it("wait until the Game is over", async () => {
    const server = await startServer({ draw: drawInOrder });
    const host = await server.signedIn("host@example.com");
    const id = await host.createGame({ name: "Still going", options: { ...RECOMMENDED_OPTIONS } });
    openApp(browser(server.origin), `/games/${id}/highlights`);

    expect(await screen.findByText(/once the game is over/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /play the slideshow/i })).not.toBeInTheDocument();
  });

  it("play as a slideshow over the whole screen, and close again", async () => {
    const { id, origin } = await partyOver();
    const user = userEvent.setup();
    const { container } = openApp(browser(origin), `/games/${id}/highlights`);

    await user.click(await screen.findByRole("button", { name: /play the slideshow/i }));
    const show = screen.getByRole("dialog", { name: /slideshow/i });
    await waitFor(() => expect(show.querySelectorAll(".hl-tile").length).toBeGreaterThan(0));

    await user.click(within(show).getByRole("button", { name: /close the slideshow/i }));
    expect(screen.queryByRole("dialog", { name: /slideshow/i })).not.toBeInTheDocument();
    expect(container.querySelectorAll(".hl-tile")).toHaveLength(0);
  });

  it("share this page's link from the phone's share menu", async () => {
    const { id, origin } = await partyOver();
    const share = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { share });
    const user = userEvent.setup();
    openApp(browser(origin), `/games/${id}/highlights`);

    await user.click(await screen.findByRole("button", { name: /share the highlights/i }));

    expect(share).toHaveBeenCalledOnce();
    const sent = share.mock.calls[0]![0] as ShareData;
    expect(sent.url).toBe(`${window.location.origin}/games/${id}/highlights`);
    expect(sent.text).toMatch(/office swap/i);
  });
});

describe("Photos at a busy party", () => {
  it("load as small copies in the Feed and the highlights page, and full size in the big screen's slideshow", async () => {
    const { host, id, origin } = await partyOver();
    openApp(browser(origin), `/games/${id}/highlights`);
    const thumb = await within(await screen.findByRole("region", { name: /photos/i })).findByRole("img", { name: /bob's face/i });
    expect(thumb.getAttribute("src")).toMatch(/\/photo-small\.jpg$/);

    cleanup();
    await host.setScreen(id, "highlights");
    const tv = openApp(browser(origin), `/games/${id}/screen`);
    await waitFor(() => expect(tv.container.querySelector(".hl-photo img")).not.toBeNull());
    // The first screen's big tile goes to the Photo.
    expect(tv.container.querySelector(".hl-photo img")!.getAttribute("src")).toMatch(/\/photo\.jpg$/);
  });
});
