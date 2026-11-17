import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { openApp, startServer } from "./harness.js";

const rosterNames = () => within(screen.getByRole("list", { name: /players/i })).getAllByRole("listitem").map((li) => li.querySelector("[data-name]")?.textContent);

describe("A demo Game", () => {
  it("is created with as many made-up Players as asked for, ready to start", async () => {
    const { signedIn } = await startServer();
    openApp(await signedIn("host@example.com"));
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /try a demo game/i }));
    const players = screen.getByLabelText(/how many players/i);
    await user.clear(players);
    await user.type(players, "6");
    await user.click(screen.getByRole("button", { name: /create demo game/i }));

    expect(await screen.findByRole("heading", { name: /demo game/i })).toBeInTheDocument();
    await screen.findByRole("button", { name: /start game/i });
    await expect.poll(() => rosterNames().length).toBe(6);
    expect(new Set(rosterNames()).size).toBe(6); // all different
    expect(screen.getByRole("button", { name: /start game/i })).toBeEnabled();
  });

  it("asks for at least 2 Players", async () => {
    const { signedIn } = await startServer();
    openApp(await signedIn("host@example.com"));
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /try a demo game/i }));
    const players = screen.getByLabelText(/how many players/i);
    expect(players).toHaveAttribute("min", "2");
    expect(players).toHaveAttribute("max", "40");
  });
});

describe("The demo page", () => {
  async function demoGame() {
    const server = await startServer();
    const host = await server.signedIn("host@example.com");
    const id = await host.createGame({ activeSlots: 1, maxSteals: 3 }, "Demo game", "self", 60, undefined, true);
    for (const [playerId, name] of [["ann", "Ann"], ["bob", "Bob"]] as const) await host.command(id, { type: "AddPlayer", playerId, name });
    return { ...server, host, id };
  }

  it("shows the Host console, a Live scoreboard tab, and the phone of one of the made-up Players", async () => {
    const { host, id } = await demoGame();
    openApp(host, `/games/${id}/demo`);
    const user = userEvent.setup();

    const consoleTab = await screen.findByRole("tab", { name: "Host console" });
    expect(consoleTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTitle("Host console")).toHaveAttribute("src", `/games/${id}`);
    expect(screen.getByTitle("Live scoreboard")).not.toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Live scoreboard" }));
    expect(screen.getByTitle("Live scoreboard")).toBeVisible();
    expect(screen.getByTitle("Live scoreboard")).toHaveAttribute("src", `/games/${id}/screen`);
    expect(screen.getByTitle("Host console")).not.toBeVisible();

    expect(screen.getByTitle("Ann's phone")).toHaveAttribute("src", `/games/${id}?demoPlayer=ann`);
    await user.selectOptions(screen.getByLabelText("Phone of"), "Bob");
    expect(screen.getByTitle("Bob's phone")).toHaveAttribute("src", `/games/${id}?demoPlayer=bob`);
  });

  it("is only for the Host", async () => {
    const { signedIn, id } = await demoGame();
    openApp(await signedIn("guest@example.com"), `/games/${id}/demo`);
    expect(await screen.findByText(/only the host of a demo game/i)).toBeInTheDocument();
  });
});

describe("A demo page's sample phone", () => {
  it("is that made-up Player's phone: the guest's view, posting as them", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const id = await host.createGame({ activeSlots: 1, maxSteals: 3 }, "Demo game", "self", 60, undefined, true);
    for (const [playerId, name] of [["ann", "Ann"], ["bob", "Bob"]] as const) await host.command(id, { type: "AddPlayer", playerId, name });

    openApp(await signedIn("host@example.com", { demoPlayer: "ann" }), `/games/${id}`);
    const user = userEvent.setup();

    // The guest's tabs, not the Host console.
    await user.click(await screen.findByRole("tab", { name: /post/i }));
    expect(screen.queryByText(/host console/i)).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox"), "Hello from Ann");
    await user.click(screen.getByRole("button", { name: /^post$/i }));
    await user.click(await screen.findByRole("tab", { name: /feed/i }));
    expect(await screen.findByText("Hello from Ann")).toBeInTheDocument();
    expect(screen.getAllByText("Ann").length).toBeGreaterThan(0);
  });
});
