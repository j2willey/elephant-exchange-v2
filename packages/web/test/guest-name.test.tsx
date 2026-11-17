import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { drawInOrder, onTab, openApp, startServer } from "./harness.js";

/** A Self sign-up Game in play, and Gus signed in on his phone. */
async function underway() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const newGame = async () => {
    const id = await host.createGame({ activeSlots: 1, maxSteals: 3 }, "Swap", "self");
    for (const name of ["Ann", "Bob"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
    await host.command(id, { type: "StartGame" });
    return id;
  };
  const id = await newGame();
  const phone = await server.signedIn("gus@example.com");
  return { ...server, host, id, newGame, phone, user: userEvent.setup() };
}

const composer = async () => {
  await onTab(/^post/i);
  return screen.findByRole("form", { name: /post to the feed/i });
};

async function postAs(user: ReturnType<typeof userEvent.setup>, name: string, words: string) {
  const form = await composer();
  await user.type(within(form).getByLabelText(/your name/i), name);
  await user.type(within(form).getByLabelText(/what's happening/i), words);
  await user.click(within(form).getByRole("button", { name: /^post$/i }));
  await within(await screen.findByRole("feed", { name: /feed/i })).findByText(words);
}

describe("A Guest's name", () => {
  it("is remembered on this phone once they've posted, in this Game and the next", async () => {
    const { id, newGame, phone, user } = await underway();
    const first = openApp(phone, `/games/${id}`);
    await postAs(user, "Gus", "Hello");
    first.unmount();

    const again = openApp(phone, `/games/${id}`);
    expect(within(await composer()).getByLabelText(/your name/i)).toHaveValue("Gus");
    again.unmount();

    openApp(phone, `/games/${await newGame()}`);
    expect(within(await composer()).getByLabelText(/your name/i)).toHaveValue("Gus");
  });

  it("fills in the name to join with, too", async () => {
    const { id, phone, user } = await underway();
    const first = openApp(phone, `/games/${id}`);
    await postAs(user, "Gus", "Hello");
    first.unmount();

    openApp(phone, `/games/${id}`);
    await onTab(/^you$/i);
    const join = await screen.findByRole("region", { name: /play in this game/i });
    expect(await within(join).findByLabelText(/your name/i)).toHaveValue("Gus");
  });

  it("stays on that phone: someone else's starts empty", async () => {
    const { id, phone, signedIn, user } = await underway();
    const first = openApp(phone, `/games/${id}`);
    await postAs(user, "Gus", "Hello");
    first.unmount();

    openApp(await signedIn("dot@example.com"), `/games/${id}`);
    await waitFor(async () => expect(within(await composer()).getByLabelText(/your name/i)).toHaveValue(""));
  });

  it("is remembered once they join as a Player", async () => {
    const { id, newGame, phone, user } = await underway();
    const first = openApp(phone, `/games/${id}`);
    await onTab(/^you$/i);
    const join = await screen.findByRole("region", { name: /play in this game/i });
    await user.type(await within(join).findByLabelText(/your name/i), "Gus");
    await user.click(within(join).getByRole("button", { name: /join as a player/i }));
    await screen.findByText(/you're playing as gus/i);
    first.unmount();

    openApp(phone, `/games/${await newGame()}`);
    expect(within(await composer()).getByLabelText(/your name/i)).toHaveValue("Gus");
  });
});
