import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawInOrder, onTab, openApp, startServer } from "./harness.js";

/** A laptop: wide enough for the two-column Host console. */
function screenWidth(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide && query.includes("min-width"), media: query, addEventListener() {}, removeEventListener() {} }));
}
beforeEach(() => screenWidth(true));
afterEach(() => vi.unstubAllGlobals());

async function finishedParty() {
  const server = await startServer({ draw: drawInOrder, adminEmails: ["boss@example.org"] });
  const host = await server.signedIn("ann@example.org");
  const id = await host.createGame({ activeSlots: 1, maxSteals: 3 }, "Office party", "self");
  const guest = await server.signedIn("gus@example.org");
  await guest.join(id, "Gus");
  for (const p of ["b", "c"]) await host.command(id, { type: "AddPlayer", playerId: p, name: p.toUpperCase() });
  await host.command(id, { type: "StartGame" });
  return { ...server, host, guest, id, user: userEvent.setup() };
}

describe("Asking how it went", () => {
  it("asks the Host on the console once they end the Game, and thanks them", async () => {
    const { host, id, user, signedIn } = await finishedParty();
    openApp(host, `/games/${id}`);
    await screen.findByRole("region", { name: /participants/i });
    expect(screen.queryByRole("form", { name: /how did it go/i })).not.toBeInTheDocument();

    await host.command(id, { type: "EndGame" });
    const ask = await screen.findByRole("form", { name: /how did it go/i });
    expect(within(ask).getByRole("button", { name: /send/i })).toBeDisabled();
    await user.click(within(ask).getByRole("radio", { name: /^4 stars/i }));
    await user.click(within(ask).getByRole("radio", { name: /^yes$/i }));
    await user.type(within(ask).getByLabelText(/anything to add/i), "The TV view was a hit");
    await user.click(within(ask).getByRole("button", { name: /send/i }));

    expect(await screen.findByText(/jim reads every answer/i)).toBeInTheDocument();
    const said = await (await signedIn("boss@example.org")).adminFeedback();
    expect(said !== "notFound" && said.items[0]).toMatchObject({ kind: "host", rating: 4, again: "yes", comment: "The TV view was a hit" });
  });

  it("asks a guest on their phone for a thumbs up once it's over and the vote is closed", async () => {
    screenWidth(false);
    const { host, guest, id, user, signedIn } = await finishedParty();
    await host.command(id, { type: "EndGame" });
    await host.setVoteStatus(id, "open");
    openApp(guest, `/games/${id}`);
    await onTab(/gifts/i);
    await screen.findByRole("region", { name: /worst gift vote/i });
    expect(screen.queryByRole("region", { name: /did you enjoy it/i })).not.toBeInTheDocument();

    await host.setVoteStatus(id, "closed");
    const ask = await screen.findByRole("region", { name: /did you enjoy it/i });
    await user.click(within(ask).getByRole("button", { name: /yes/i }));
    await user.type(await screen.findByLabelText(/anything to add/i), "So fun");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(async () => {
      const said = await (await signedIn("boss@example.org")).adminFeedback();
      expect(said !== "notFound" && said.items[0]).toMatchObject({ kind: "guest", thumbs: "up", comment: "So fun" });
    });
  });

  it("takes a suggestion from the Host's home screen, and shows it all on the admin's Feedback page", async () => {
    const { signedIn } = await startServer({ adminEmails: ["boss@example.org"] });
    const user = userEvent.setup();
    openApp(await signedIn("ann@example.org"));

    const box = await screen.findByRole("form", { name: /suggest something/i });
    await user.type(within(box).getByRole("textbox"), "A dark mode, please");
    await user.click(within(box).getByRole("button", { name: /send to jim/i }));
    expect(await within(box).findByRole("status")).toHaveTextContent(/thanks/i);

    openApp(await signedIn("boss@example.org"), "/admin/feedback");
    const list = await screen.findByRole("list", { name: /what people said/i });
    expect(list).toHaveTextContent(/suggestion.*ann@example.org.*a dark mode, please/i);
  });
});
