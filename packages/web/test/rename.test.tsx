import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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
afterEach(() => vi.unstubAllGlobals());

/** A Self sign-up Game: a teen joined as "Mr. Big" and posted, and a Guest posted as "Rude Dude". */
async function party() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ activeSlots: 1, maxSteals: 3 }, "Troop Party", "self");
  const teen = await server.signedIn("teen@example.com");
  await teen.join(id, "Mr. Big");
  await teen.post(id, { text: "lol" });
  const guest = await server.signedIn("guest@example.com");
  await guest.post(id, { text: "hey", name: "Rude Dude" });
  return { ...server, host, teen, guest, id, user: userEvent.setup() };
}

const rename = async (where: HTMLElement, from: RegExp, to: string, user: ReturnType<typeof userEvent.setup>) => {
  await user.click(within(where).getByRole("button", { name: from }));
  const form = within(where).getByRole("form", { name: /rename/i });
  expect(within(form).getByRole("checkbox", { name: /lock/i })).toBeChecked();
  await user.clear(within(form).getByLabelText(/new name/i));
  await user.type(within(form).getByLabelText(/new name/i), to);
  await user.click(within(form).getByRole("button", { name: /save/i }));
};

describe("The Host renaming someone, and locking the name", () => {
  it("renames a Player from the Participants list, on the roster and their Posts", async () => {
    screenWidth(true);
    const { host, teen, id, user } = await party();
    openApp(host, `/games/${id}`);

    const participants = await screen.findByRole("region", { name: /participants/i });
    await rename(await within(participants).findByRole("listitem", { name: /^mr\. big/i }), /rename mr\. big/i, "Sam", user);

    await within(participants).findByRole("listitem", { name: /^sam\b/i });
    await waitFor(async () => expect((await host.posts(id)).map((p) => p.author)).not.toContain("Mr. Big"));
    expect((await teen.game(id))!.myName).toEqual({ name: "Sam", locked: true });
  });

  it("renames a Guest from one of their Posts in the Feed", async () => {
    screenWidth(false);
    const { host, guest, id, user } = await party();
    openApp(host, `/games/${id}`);

    const feed = await screen.findByRole("feed", { name: /feed/i });
    await rename(await within(feed).findByRole("article", { name: /rude dude/i }), /rename rude dude/i, "Guest Gary", user);

    await within(feed).findByRole("article", { name: /guest gary/i });
    expect((await guest.game(id))!.myName).toEqual({ name: "Guest Gary", locked: true });
  });

  it("renames a Player from the phone's Players list", async () => {
    screenWidth(false);
    const { host, id, user } = await party();
    openApp(host, `/games/${id}`);

    const players = await screen.findByRole("list", { name: /^players$/i });
    await rename((await within(players).findByText("Mr. Big")).closest("li")!, /rename mr\. big/i, "Sam", user);
    await within(players).findByText("Sam");
  });

  it("isn't offered to Players or Guests", async () => {
    screenWidth(false);
    const { guest, id } = await party();
    openApp(guest, `/games/${id}`);
    await onTab(/^feed/i);
    await screen.findByRole("article", { name: /mr\. big/i });
    expect(screen.queryByRole("button", { name: /rename/i })).not.toBeInTheDocument();
  });
});

describe("A Guest whose name is locked", () => {
  it("isn't asked for a name when posting, and is told the Host set it", async () => {
    screenWidth(false);
    const { host, guest, id } = await party();
    const post = (await host.posts(id)).find((p) => p.author === "Rude Dude")!;
    await host.rename(id, { postId: post.id }, "Guest Gary", true);
    openApp(guest, `/games/${id}`);
    await onTab(/^post/i);

    const form = await screen.findByRole("form", { name: /post to the feed/i });
    expect(within(form).queryByLabelText(/your name/i)).not.toBeInTheDocument();
    expect(form).toHaveTextContent(/posting as guest gary/i);
    expect(form).toHaveTextContent(/your host set this name/i);
  });
});

describe("Changing your own name", () => {
  it("is on a Player's You tab, and changes it on the roster", async () => {
    screenWidth(false);
    const { teen, id, user } = await party();
    openApp(teen, `/games/${id}`);
    await onTab(/^you$/i);

    const you = await screen.findByRole("region", { name: /^you$/i });
    await user.click(within(you).getByRole("button", { name: /change my name/i }));
    const form = within(you).getByRole("form", { name: /change my name/i });
    await user.clear(within(form).getByLabelText(/your name/i));
    await user.type(within(form).getByLabelText(/your name/i), "Sam");
    await user.click(within(form).getByRole("button", { name: /save/i }));

    await within(you).findByText(/playing as sam/i);
    expect((await teen.game(id))!.players.map((p) => p.name)).toContain("Sam");
  });

  it("is on a Guest's You tab once they've posted", async () => {
    screenWidth(false);
    const { guest, id, user } = await party();
    openApp(guest, `/games/${id}`);
    await onTab(/^you$/i);

    const mine = await screen.findByRole("region", { name: /your name/i });
    expect(mine).toHaveTextContent(/rude dude/i);
    await user.click(within(mine).getByRole("button", { name: /change my name/i }));
    await user.clear(within(mine).getByLabelText(/your name/i));
    await user.type(within(mine).getByLabelText(/your name/i), "Gary");
    await user.click(within(mine).getByRole("button", { name: /save/i }));

    await waitFor(async () => expect((await guest.posts(id)).find((p) => p.text === "hey")!.author).toBe("Gary"));
  });

  it("isn't offered once the Host has locked it, and says why", async () => {
    screenWidth(false);
    const { host, teen, id } = await party();
    await host.rename(id, { playerId: (await teen.game(id))!.me!.playerId }, "Sam", true);
    openApp(teen, `/games/${id}`);
    await onTab(/^you$/i);

    const you = await screen.findByRole("region", { name: /^you$/i });
    await within(you).findByText(/your host set this name/i);
    expect(within(you).queryByRole("button", { name: /change my name/i })).not.toBeInTheDocument();
  });
});
