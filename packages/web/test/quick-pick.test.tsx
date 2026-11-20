import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { drawInOrder, openApp, startServer } from "./harness.js";

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

/** A Game under way with Ann up first. */
async function underway() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ name: "Acme Holiday Party", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
  for (const name of ["Ann", "Bob", "Cat"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
  await host.command(id, { type: "StartGame" });
  return { ...server, host, id, user: userEvent.setup() };
}

describe("Opening a Gift now and naming it later, on a laptop", () => {
  it("records the open without a name, marks the Gift as needing one, and takes the name afterwards", async () => {
    screenWidth(true);
    const { host, id, user } = await underway();
    openApp(host, `/games/${id}`);

    await user.click(await screen.findByRole("button", { name: /open a gift for ann/i }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /name it later/i }));

    const tracker = await screen.findByRole("region", { name: /gift tracker/i });
    const gift = await within(tracker).findByRole("listitem", { name: /ann's gift/i });
    expect(gift).toHaveTextContent(/what is it\?/i);
    expect(gift).toHaveTextContent(/ann/i);

    await user.click(within(gift).getByRole("button", { name: /what is ann's gift/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/what's inside/i)).toHaveValue("");
    await user.type(within(dialog).getByLabelText(/what's inside/i), "Lava lamp");
    await user.click(within(dialog).getByRole("button", { name: /save/i }));

    const named = await within(tracker).findByRole("listitem", { name: /lava lamp/i });
    expect(named).not.toHaveTextContent(/what is it\?/i);
  });
});

describe("Opening a Gift now and naming it later, on a phone", () => {
  it("has a button for it on the turn, and the Gifts list asks for the name", async () => {
    screenWidth(false);
    const { host, id, user } = await underway();
    openApp(host, `/games/${id}`);

    const turn = await screen.findByRole("region", { name: /ann's turn/i });
    await user.click(within(turn).getByRole("button", { name: /name it later/i }));

    const gifts = await screen.findByRole("list", { name: /^gifts$/i });
    const gift = await within(gifts).findByRole("listitem", { name: /ann's gift/i });
    expect(gift).toHaveTextContent(/what is it\?/i);

    await user.click(within(gift).getByRole("button", { name: /what is ann's gift/i }));
    const form = within(gift).getByRole("form");
    expect(within(form).getByLabelText(/what's inside/i)).toHaveValue("");
    await user.type(within(form).getByLabelText(/what's inside/i), "Lava lamp");
    await user.click(within(form).getByRole("button", { name: /save/i }));

    await waitFor(() => expect(within(gifts).getByRole("listitem", { name: /lava lamp/i })).not.toHaveTextContent(/what is it\?/i));
  });
});
