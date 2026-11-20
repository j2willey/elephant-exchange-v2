import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawInOrder, onTab, openApp, startServer } from "./harness.js";

/** Laptop or phone: the test browser has no screen size of its own. */
function screenWidth(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: wide && query.includes("min-width"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}
beforeEach(() => screenWidth(false));
afterEach(() => vi.unstubAllGlobals());

/** Gus starts a rude thread that Dot replies to; Eve posts on her own. */
async function party() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ name: "Troop Party", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
  const gus = await server.signedIn("gus@example.com");
  const dot = await server.signedIn("dot@example.com");
  const eve = await server.signedIn("eve@example.com");
  await gus.post(id, { text: "Rude start", name: "Gus" });
  const start = (await host.posts(id)).find((p) => p.text === "Rude start")!;
  await dot.post(id, { text: "Dot replies", name: "Dot", replyTo: start.id });
  await eve.post(id, { text: "Eve alone", name: "Eve" });
  return { ...server, host, gus, dot, eve, id, user: userEvent.setup() };
}

const shown = async (api: { posts: (id: string) => Promise<{ text: string; status: string }[]> }, id: string) =>
  (await api.posts(id)).filter((p) => p.status === "visible").map((p) => p.text).sort();

const feedPost = async (author: RegExp) => within(await screen.findByRole("feed", { name: /feed/i })).findByRole("article", { name: author });

describe("Hiding a thread from the Feed", () => {
  it("offers Hide with replies on a Post that has replies, and Show again brings them back", async () => {
    const { host, eve, id, user } = await party();
    openApp(host, `/games/${id}`);

    const gus = await feedPost(/gus/i);
    await user.click(within(gus).getByRole("button", { name: /hide with replies/i }));
    await waitFor(async () => expect(await shown(eve, id)).toEqual(["Eve alone"]));

    await user.click(within(await feedPost(/gus/i)).getByRole("button", { name: /show again/i }));
    await waitFor(async () => expect(await shown(eve, id)).toEqual(["Dot replies", "Eve alone", "Rude start"]));
  });

  it("isn't offered on a Post without replies", async () => {
    const { host, id } = await party();
    openApp(host, `/games/${id}`);
    expect(within(await feedPost(/eve/i)).queryByRole("button", { name: /hide with replies/i })).not.toBeInTheDocument();
  });
});

describe("Muting a poster from the Feed", () => {
  it("mutes them, optionally hiding their Posts, marks them Muted, and unmutes", async () => {
    const { host, eve, gus, id, user } = await party();
    openApp(host, `/games/${id}`);

    await user.click(within(await feedPost(/gus/i)).getByRole("button", { name: /^.*mute gus/i }));
    const form = within(await feedPost(/gus/i)).getByRole("form", { name: /mute gus/i });
    await user.click(within(form).getByRole("checkbox", { name: /also hide their posts/i }));
    await user.click(within(form).getByRole("button", { name: /^mute$/i }));

    await waitFor(async () => expect(await shown(eve, id)).toEqual(["Dot replies", "Eve alone"]));
    expect((await gus.game(id))!.muted).toBe(true);
    await waitFor(async () => expect(await feedPost(/gus/i)).toHaveTextContent(/muted/i));

    await user.click(within(await feedPost(/gus/i)).getByRole("button", { name: /unmute gus/i }));
    await waitFor(async () => expect((await gus.game(id))!.muted).toBe(false));
    await waitFor(async () => expect(await shown(eve, id)).toContain("Rude start"));
  });

  it("tells the muted person, in place of the form to post", async () => {
    const { host, gus, id } = await party();
    await host.mute(id, (await host.posts(id)).find((p) => p.text === "Rude start")!.id, true);
    openApp(gus, `/games/${id}`);
    await onTab(/^post/i);

    await screen.findByText(/the host has paused your posting/i);
    expect(screen.queryByRole("form", { name: /post to the feed/i })).not.toBeInTheDocument();
  });
});
