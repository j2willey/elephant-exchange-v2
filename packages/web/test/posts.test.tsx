import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { browser, drawInOrder, onTab, openApp, startServer } from "./harness.js";

/** A Game in play with Socks and Mug opened, Ann and Bob holding them. */
async function underway() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ activeSlots: 1, maxSteals: 3 }, "Troop swap", "self");
  for (const name of ["Ann", "Bob", "Cat"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
  await host.command(id, { type: "StartGame" });
  await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });
  await host.command(id, { type: "OpenGift", playerId: "bob", giftId: "g2", name: "Mug" });
  return { ...server, host, id, user: userEvent.setup() };
}

const feed = async () => {
  await onTab(/feed/i);
  return screen.findByRole("feed", { name: /feed/i });
};
const postsInFeed = async () => within(await feed()).queryAllByRole("article").map((a) => a.textContent);
const feedShows = (text: RegExp) => waitFor(async () => expect((await postsInFeed()).join("\n")).toMatch(text));

/** Writes a Post from the open screen, about a Gift if one is named; `phone` picks the screen when more than one is open. */
async function post(user: ReturnType<typeof userEvent.setup>, words: string, opts: { as?: string; about?: string; phone?: HTMLElement } = {}) {
  await onTab(/^post/i, opts.phone);
  const form = await screen.findByRole("form", { name: /post to the feed/i });
  const yourName = within(form).queryByLabelText(/your name/i);
  if (yourName && opts.as) await user.type(yourName, opts.as);
  await user.type(within(form).getByLabelText(/what's happening/i), words);
  if (opts.about) await user.selectOptions(within(form).getByLabelText(/about a gift/i), opts.about);
  await user.click(within(form).getByRole("button", { name: /^post$/i }));
}

async function setModeration(user: ReturnType<typeof userEvent.setup>, mode: RegExp) {
  await user.click(await screen.findByRole("radio", { name: mode }));
}

describe("Posts", () => {
  it("lets a signed-in Guest post a few words, which everyone following sees at once", async () => {
    const { origin, signedIn, id, user } = await underway();
    const watcher = browser(origin);
    openApp(watcher, `/games/${id}`);
    await feed();

    const guest = await signedIn("gus@example.com");
    const guestScreen = openApp(guest, `/games/${id}`);
    await post(user, "Those socks are amazing", { as: "Gus", phone: guestScreen.container });
    guestScreen.unmount();

    await feedShows(/gus.*those socks are amazing/i);
  });

  it("posts as the Player's own name for someone who joined as a Player", async () => {
    const { signedIn, id, user } = await underway();
    const dan = await signedIn("dan@example.com");
    await dan.join(id, "Dan");
    openApp(dan, `/games/${id}`);

    await post(user, "Hi all");

    await feedShows(/dan.*hi all/i);
    await onTab(/^post/i);
    expect(within(await screen.findByRole("form", { name: /post to the feed/i })).queryByLabelText(/your name/i)).not.toBeInTheDocument();
  });

  it("shows a Post about a Gift in the Feed and under that Gift", async () => {
    const { signedIn, id, user } = await underway();
    openApp(await signedIn("gus@example.com"), `/games/${id}`);

    await post(user, "It's a heated mug!", { as: "Gus", about: "Mug" });

    await feedShows(/about mug.*it's a heated mug!/i);
    await onTab(/gifts/i);
    await waitFor(() => expect(screen.getByRole("listitem", { name: "Mug" })).toHaveTextContent(/it's a heated mug!/i));
    expect(screen.getByRole("listitem", { name: "Socks" })).not.toHaveTextContent(/heated/i);
  });

  it("lets someone signed out read the Feed, and offers them sign-in to post", async () => {
    const { origin, signedIn, id } = await underway();
    const guest = await signedIn("gus@example.com");
    await guest.post(id, { text: "First!", name: "Gus" });

    openApp(browser(origin), `/games/${id}`);

    await feedShows(/first!/i);
    await onTab(/^post/i);
    // The sign-in offer comes once the page has checked who's there, which may be after the Feed loads.
    expect(await screen.findByRole("button", { name: /send.*link/i })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /post to the feed/i })).not.toBeInTheDocument();
  });
});

describe("Moderation", () => {
  it("under Approval, holds each Post until the Host approves it", async () => {
    const { origin, host, signedIn, id, user } = await underway();
    const hostScreen = openApp(host, `/games/${id}/settings`);
    await setModeration(user, /approval/i);
    hostScreen.unmount();

    const guest = await signedIn("gus@example.com");
    const guestScreen = openApp(guest, `/games/${id}`);
    await post(user, "Is this on?", { as: "Gus" });
    await feedShows(/waiting for the host.*is this on\?/i);
    guestScreen.unmount();

    const other = openApp(browser(origin), `/games/${id}`);
    await feed();
    expect(await postsInFeed()).toEqual([]);
    other.unmount();

    openApp(host, `/games/${id}`);
    const pending = await within(await feed()).findByRole("article");
    await user.click(within(pending).getByRole("button", { name: /approve/i }));
    await feedShows(/^(?!.*waiting).*is this on\?/i);
  });

  it("lets the Host hide a Post from everyone, and show it again", async () => {
    const { origin, host, signedIn, id, user } = await underway();
    await (await signedIn("gus@example.com")).post(id, { text: "Something rude", name: "Gus" });
    const watcher = browser(origin);
    openApp(host, `/games/${id}`);

    const rude = await within(await feed()).findByRole("article");
    await user.click(within(rude).getByRole("button", { name: /hide/i }));
    await waitFor(() => expect(within(rude).getByText(/hidden/i)).toBeInTheDocument());

    expect(await watcher.posts(id)).toEqual([]);
    await user.click(within(rude).getByRole("button", { name: /show again/i }));
    await waitFor(async () => expect(await watcher.posts(id)).toHaveLength(1));
  });

  it("lets the Host pause posting, which takes the form away from everyone", async () => {
    const { host, signedIn, id, user } = await underway();
    const guest = await signedIn("gus@example.com");
    const hostScreen = openApp(host, `/games/${id}/settings`);
    await setModeration(user, /paused/i);
    hostScreen.unmount();

    openApp(guest, `/games/${id}`);
    await onTab(/^post/i);

    expect(await screen.findByText(/the host has paused posting/i)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /post to the feed/i })).not.toBeInTheDocument();
  });

  it("isn't offered to anyone but the Host and Co-hosts", async () => {
    const { signedIn, id } = await underway();
    openApp(await signedIn("gus@example.com"), `/games/${id}`);

    await feed();
    expect(screen.queryByRole("radio", { name: /approval/i })).not.toBeInTheDocument();
  });
});

describe("Reactions", () => {
  it("lets a guest react to a Post from the Feed, which everyone following sees, and take it back", async () => {
    const { origin, signedIn, id, user } = await underway();
    await (await signedIn("gus@example.com")).post(id, { text: "Socks again!", name: "Gus" });
    const watcher = browser(origin);
    openApp(await signedIn("eve@example.com"), `/games/${id}`);

    const socks = await within(await feed()).findByRole("article");
    await user.click(await within(socks).findByRole("button", { name: /^react/i }));
    await user.click(within(socks).getByRole("button", { name: /funny/i }));

    const mine = await within(socks).findByRole("button", { name: /funny: 1/i });
    expect(mine).toHaveAttribute("aria-pressed", "true");
    await waitFor(async () => expect((await watcher.posts(id))[0]!.reactions).toEqual([{ emoji: "😂", count: 1, mine: false }]));

    await user.click(mine);
    await waitFor(async () => expect((await watcher.posts(id))[0]!.reactions).toEqual([]));
    await waitFor(() => expect(within(socks).queryByRole("button", { name: /funny: 1/i })).not.toBeInTheDocument());
  });

  it("offers the holiday ones too: a snowman and the leg lamp", async () => {
    const { signedIn, id, user } = await underway();
    await (await signedIn("gus@example.com")).post(id, { text: "A major award!", name: "Gus" });
    openApp(await signedIn("eve@example.com"), `/games/${id}`);

    const award = await within(await feed()).findByRole("article");
    await user.click(await within(award).findByRole("button", { name: /^react/i }));
    await user.click(within(award).getByRole("button", { name: /^leg lamp$/i }));
    await user.click(await within(award).findByRole("button", { name: /^react/i }));
    await user.click(within(award).getByRole("button", { name: /^snowman$/i }));

    await waitFor(() => expect(within(award).getByRole("button", { name: /leg lamp: 1/i })).toHaveAttribute("aria-pressed", "true"));
    await waitFor(() => expect(within(award).getByRole("button", { name: /snowman: 1/i })).toHaveTextContent("⛄"));
  });

  it("shows the counts to someone signed out, without a way to react", async () => {
    const { origin, signedIn, id } = await underway();
    const gus = await signedIn("gus@example.com");
    await gus.post(id, { text: "Socks again!", name: "Gus" });
    const [p] = await gus.posts(id);
    await gus.react(id, p!.id, "🔥", true);

    openApp(browser(origin), `/games/${id}`);

    const socks = await within(await feed()).findByRole("article");
    await waitFor(() => expect(within(socks).getByText(/🔥\s*1/)).toBeInTheDocument());
    expect(within(socks).queryByRole("button", { name: /^react/i })).not.toBeInTheDocument();
  });
});

describe("Replies", () => {
  /** Pat's Post in the Feed, and Sam signed in on the phone in front of us. */
  async function patPosted() {
    const s = await underway();
    const pat = await s.signedIn("pat@example.com");
    await pat.post(s.id, { text: "Stole the lamp!", name: "Pat" });
    return { ...s, pat };
  }
  const article = async (text: RegExp) => within(await feed()).findByRole("article", { name: text });

  it("lets a guest reply to a Post, quoting it, and counts the reply on the original", async () => {
    const { origin, signedIn, id, user } = await patPosted();
    openApp(await signedIn("sam@example.com"), `/games/${id}`);

    const lamp = await article(/pat/i);
    await user.click(await within(lamp).findByRole("button", { name: /^reply/i }));
    const form = await within(lamp).findByRole("form", { name: /reply to pat/i });
    await user.type(within(form).getByLabelText(/your name/i), "Sam");
    await user.type(within(form).getByLabelText(/your reply/i), "Third time!");
    expect(within(form).queryByLabelText(/about a gift/i)).not.toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: /^post$/i }));

    const reply = await article(/sam/i);
    await waitFor(() => expect(within(reply).getByRole("button", { name: /replying to pat/i })).toHaveTextContent(/stole the lamp/i));
    await waitFor(async () => expect(await article(/pat/i)).toHaveTextContent(/1 reply/i));
    const [first] = (await browser(origin).posts(id)).filter((p) => p.replyTo);
    expect(first!.text).toBe("Third time!");
  });

  it("jumps to the original when the quote is tapped", async () => {
    const { signedIn, id, user, pat } = await patPosted();
    const [lamp] = await pat.posts(id);
    await (await signedIn("sam@example.com")).post(id, { text: "Third time!", name: "Sam", replyTo: lamp!.id });
    openApp(await signedIn("eve@example.com"), `/games/${id}`);

    await user.click(within(await article(/sam/i)).getByRole("button", { name: /replying to pat/i }));

    expect(await article(/pat/i)).toHaveFocus();
  });

  it("says the original was removed once the Host hides it", async () => {
    const { host, signedIn, id, pat } = await patPosted();
    const [lamp] = await pat.posts(id);
    await (await signedIn("sam@example.com")).post(id, { text: "Third time!", name: "Sam", replyTo: lamp!.id });
    await host.setPostStatus(id, lamp!.id, "hidden");
    openApp(await signedIn("eve@example.com"), `/games/${id}`);

    expect(await article(/sam/i)).toHaveTextContent(/original post removed/i);
  });

  it("isn't offered while posting is Paused", async () => {
    const { host, signedIn, id } = await patPosted();
    await host.setModeration(id, "paused");
    openApp(await signedIn("sam@example.com"), `/games/${id}`);

    const lamp = await article(/pat/i);
    await within(lamp).findByRole("button", { name: /^react/i }); // signed in, and the Feed is ready
    expect(within(lamp).queryByRole("button", { name: /^reply/i })).not.toBeInTheDocument();
  });
});
