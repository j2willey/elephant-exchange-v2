import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browser, drawInOrder, openApp, startServer } from "./harness.js";

/** The test browser has no screen size of its own: wide is a laptop, narrow a phone. */
function screenWidth(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: wide && query.includes("min-width"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}
afterEach(() => vi.unstubAllGlobals());

/** Ann opened an espresso machine, typed in a hurry. */
async function opened() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ activeSlots: 1, maxSteals: 3 }, "Acme Holiday Party");
  for (const name of ["Ann", "Bob"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
  await host.command(id, { type: "StartGame" });
  await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Espreso" });
  return { ...server, host, id, user: userEvent.setup() };
}

const tracker = () => screen.findByRole("region", { name: /gift tracker/i });

describe("Describing a Gift from the laptop console", () => {
  it("takes optional details when the Gift is opened", async () => {
    screenWidth(true);
    const { host, id, user } = await opened();
    openApp(host, `/games/${id}`);

    const participants = await screen.findByRole("region", { name: /participants/i });
    await user.click(within(participants).getByRole("button", { name: /open a gift for bob/i }));
    const dialog = await screen.findByRole("dialog", { name: /bob/i });
    await user.type(within(dialog).getByLabelText(/what's inside/i), "Lava lamp");
    await user.type(within(dialog).getByLabelText(/details/i), "1970s, red, spare bulb");
    await user.click(within(dialog).getByRole("button", { name: /save/i }));

    const lamp = await within(await tracker()).findByRole("listitem", { name: "Lava lamp" });
    expect(lamp).toHaveTextContent(/1970s, red, spare bulb/i);
  });

  it("corrects a Gift's name and adds details from the Gift Tracker", async () => {
    screenWidth(true);
    const { host, id, user } = await opened();
    openApp(host, `/games/${id}`);

    await user.click(within(await within(await tracker()).findByRole("listitem", { name: "Espreso" })).getByRole("button", { name: /edit espreso/i }));
    const dialog = await screen.findByRole("dialog", { name: /edit/i });
    expect(within(dialog).getByLabelText(/what's inside/i)).toHaveValue("Espreso");
    expect(dialog).toHaveTextContent(/held by ann/i);
    await user.clear(within(dialog).getByLabelText(/what's inside/i));
    await user.type(within(dialog).getByLabelText(/what's inside/i), "Espresso machine");
    await user.type(within(dialog).getByLabelText(/details/i), "Breville, barely used");
    await user.click(within(dialog).getByRole("button", { name: /save/i }));

    const fixed = await within(await tracker()).findByRole("listitem", { name: "Espresso machine" });
    expect(fixed).toHaveTextContent(/breville, barely used/i);
    expect(fixed).toHaveTextContent(/held by ann/i);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect((await host.game(id))?.gifts[0]).toMatchObject({ name: "Espresso machine", description: "Breville, barely used" });
  });

  it("still works once the Game is over, ahead of the vote", async () => {
    screenWidth(true);
    const { host, id, user } = await opened();
    await host.command(id, { type: "EndGame" });
    openApp(host, `/games/${id}`);

    await user.click(within(await within(await tracker()).findByRole("listitem", { name: "Espreso" })).getByRole("button", { name: /edit/i }));
    const dialog = await screen.findByRole("dialog", { name: /edit/i });
    await user.type(within(dialog).getByLabelText(/what's inside/i), "s");
    await user.click(within(dialog).getByRole("button", { name: /save/i }));

    expect(await within(await tracker()).findByRole("listitem", { name: "Espresos" })).toBeInTheDocument();
  });
});

describe("Describing a Gift from the Host's phone", () => {
  it("edits a Gift from the Gifts list", async () => {
    screenWidth(false);
    const { host, id, user } = await opened();
    openApp(host, `/games/${id}`);

    const gifts = await screen.findByRole("list", { name: /^gifts$/i });
    await user.click(within(within(gifts).getByRole("listitem", { name: "Espreso" })).getByRole("button", { name: /edit espreso/i }));
    const form = await screen.findByRole("form", { name: /edit espreso/i });
    await user.clear(within(form).getByLabelText(/what's inside/i));
    await user.type(within(form).getByLabelText(/what's inside/i), "Espresso machine");
    await user.type(within(form).getByLabelText(/details/i), "Breville");
    await user.click(within(form).getByRole("button", { name: /save/i }));

    expect(await within(gifts).findByRole("listitem", { name: "Espresso machine" })).toHaveTextContent(/breville/i);
    expect(screen.queryByRole("form", { name: /edit/i })).not.toBeInTheDocument();
  });

  it("isn't offered to guests, who see the details", async () => {
    screenWidth(false);
    const { origin, host, id } = await opened();
    await host.command(id, { type: "DescribeGift", giftId: "g1", name: "Espresso machine", description: "Breville, barely used" });
    openApp(browser(origin), `/games/${id}`);

    const gift = await screen.findByRole("listitem", { name: "Espresso machine" });
    expect(gift).toHaveTextContent(/breville, barely used/i);
    expect(within(gift).queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });
});

describe("A Gift's details on the big screen", () => {
  it("shows under its name on the board and in the catalog, and follows a correction", async () => {
    const { origin, host, id } = await opened();
    openApp(browser(origin), `/games/${id}/screen`);
    await screen.findByRole("listitem", { name: "Espreso" });

    await host.command(id, { type: "DescribeGift", giftId: "g1", name: "Espresso machine", description: "Breville, barely used" });
    expect(await screen.findByRole("listitem", { name: "Espresso machine" })).toHaveTextContent(/breville, barely used/i);

    await host.setScreen(id, "catalog");
    const catalog = await screen.findByRole("list", { name: /catalog/i });
    expect(within(catalog).getByRole("listitem", { name: "Espresso machine" })).toHaveTextContent(/breville, barely used/i);
  });
});
