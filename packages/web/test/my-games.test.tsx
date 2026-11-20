import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { openApp, startServer } from "./harness.js";

const myGames = () => screen.findByRole("list", { name: /your games/i });

describe("My Games", () => {
  it("names a new Game and lists it on the Host's home screen, linking back to it", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const first = openApp(host);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /new game/i }));
    await user.clear(screen.getByLabelText(/name of the game/i));
    await user.type(screen.getByLabelText(/name of the game/i), "OA Holiday Party");
    await user.click(screen.getByRole("button", { name: /use recommended settings/i }));

    expect(await screen.findByRole("heading", { name: "OA Holiday Party" })).toBeInTheDocument();
    const gameLink = screen.getByRole("link", { name: /link for guests/i }).getAttribute("href");
    first.unmount();

    openApp(host);
    const link = within(await myGames()).getByRole("link", { name: /oa holiday party/i });
    expect(link).toHaveAttribute("href", gameLink);
  });

  it("lists the newest first, with each Game's progress", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const older = await host.createGame({ name: "Office swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    for (const name of ["Ann", "Bob"]) await host.command(older, { type: "AddPlayer", playerId: name, name });
    await host.command(older, { type: "StartGame" });
    await host.createGame({ name: "Family swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });

    openApp(host);

    const items = within(await myGames()).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringMatching(/family swap.*not started.*0 players/i),
      expect.stringMatching(/office swap.*in progress.*2 players/i),
    ]);
  });

  it("includes Games the person is a Co-host of, but not other people's", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const shared = await host.createGame({ name: "Troop swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    await host.addCohost(shared, "bob@example.com");
    await host.createGame({ name: "Host's own swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });

    openApp(await signedIn("bob@example.com"));

    const items = within(await myGames()).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent(/troop swap.*co-host/i);
  });

  it("says so when there are no Games yet", async () => {
    const { signedIn } = await startServer();
    openApp(await signedIn("new@example.com"));

    expect(await screen.findByText(/you haven't run any games yet/i)).toBeInTheDocument();
  });
});
