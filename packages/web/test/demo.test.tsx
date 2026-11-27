import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browser, openApp, startServer } from "./harness.js";

const rosterNames = () => within(screen.getByRole("list", { name: /players/i })).getAllByRole("listitem").map((li) => li.querySelector("[data-name]")?.textContent);

describe("A demo Game", () => {
  it("is created with as many made-up Players as asked for, ready to start", async () => {
    const { signedIn } = await startServer();
    openApp(await signedIn("host@example.com"));
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /try a demo/i }));
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

  it("is turned away kindly when the server is too busy, leaving the parties under way alone", async () => {
    const { signedIn } = await startServer({ overload: { maxScreens: 0 } });
    openApp(await signedIn("host@example.com"));
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /try a demo/i }));
    await user.click(screen.getByRole("button", { name: /create demo game/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/very busy right now.*try again in a few minutes/i);
  });

  it("comes after the guided tour, which a visitor is offered first", async () => {
    const { origin, signedIn } = await startServer();
    openApp(browser(origin), "/try");
    const tour = await screen.findByRole("link", { name: /watch the guided tour/i });
    expect(tour).toHaveAttribute("href", "/guided/happy-path");
    const create = screen.getByRole("button", { name: /create demo game/i });
    expect(tour.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();

    // The same from a signed-in Host's home.
    openApp(await signedIn("host@example.com"));
    await userEvent.setup().click(await screen.findByRole("button", { name: /try a demo/i }));
    expect(await screen.findByRole("link", { name: /watch the guided tour/i })).toHaveAttribute("href", "/guided/happy-path");
  });

  it("counts as a demo started, in the admin's statistics", async () => {
    const { signedIn } = await startServer({ adminEmails: ["boss@example.org"] });
    openApp(await signedIn("host@example.com"));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /try a demo/i }));
    await user.click(screen.getByRole("button", { name: /create demo game/i }));
    await screen.findByRole("button", { name: /start game/i });

    const stats = await (await signedIn("boss@example.org")).adminStats();
    expect(stats !== "notFound" && stats.insights.demosStarted).toEqual([{ day: expect.any(String), self: 1, guided: 0 }]);
  });

  it("asks for at least 2 Players", async () => {
    const { signedIn } = await startServer();
    openApp(await signedIn("host@example.com"));
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /try a demo/i }));
    const players = screen.getByLabelText(/how many players/i);
    expect(players).toHaveAttribute("min", "2");
    expect(players).toHaveAttribute("max", "50");
  });
});

describe("The demo page", () => {
  async function demoGame() {
    const server = await startServer();
    const host = await server.signedIn("host@example.com");
    const id = await host.createGame({ name: "Demo game", demo: true, options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3, rosterMode: "self", turnSeconds: 60 } });
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

describe("A demo Game's hint", () => {
  const hint = () => screen.findByRole("note", { name: /how to run the demo/i });

  it("tells the visitor they're the Host and what to press for the turn at hand, with the guided tour to watch instead", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const id = await host.createGame({ name: "Demo game", demo: true, options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3, rosterMode: "self", turnSeconds: 60 } });
    for (const [playerId, name] of [["ann", "Ann"], ["bob", "Bob"]] as const) await host.command(id, { type: "AddPlayer", playerId, name });
    openApp(host, `/games/${id}`);

    expect(await hint()).toHaveTextContent(/you're the host.*press start game/i);
    expect(within(await hint()).getByRole("link", { name: /watch the guided tour/i })).toHaveAttribute("href", "/guided/happy-path?autoplay");

    await host.command(id, { type: "StartGame" });
    await expect.poll(async () => (await hint()).textContent).toMatch(/it's (ann|bob)'s turn.*press 🎁.*press 😈/i);
  });

  it("isn't on a real Game", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const id = await host.createGame({ name: "Acme Holiday Party", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    openApp(host, `/games/${id}`);
    await screen.findByText(/acme holiday party/i);
    expect(screen.queryByRole("note", { name: /how to run the demo/i })).not.toBeInTheDocument();
  });
});

describe("A demo page's sample phone", () => {
  it("is that made-up Player's phone: the guest's view, posting as them", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const id = await host.createGame({ name: "Demo game", demo: true, options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3, rosterMode: "self", turnSeconds: 60 } });
    for (const [playerId, name] of [["ann", "Ann"], ["bob", "Bob"]] as const) await host.command(id, { type: "AddPlayer", playerId, name });

    openApp(await signedIn("host@example.com", { demoPlayer: "ann" }), `/games/${id}`);
    const user = userEvent.setup();

    // The guest's tabs, not the Host console.
    await user.click(await screen.findByRole("tab", { name: /post/i }));
    expect(screen.queryByText(/host console/i)).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox"), "Hello from Ann");
    await user.click(screen.getByRole("button", { name: /^post$/i }));
    await user.click(await screen.findByRole("tab", { name: /chat/i }));
    expect(await screen.findByText("Hello from Ann")).toBeInTheDocument();
    expect(screen.getAllByText("Ann").length).toBeGreaterThan(0);
  });
});

/** The demo's gift-table Photo, as the browser would fetch it from the build; anything else goes on to the server. */
function giftTablePhotoServed() {
  const real = globalThis.fetch;
  const bytes = readFileSync(join(import.meta.dirname, "../src/assets/demo-gift-table.webp"));
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes("demo-gift-table") ? Promise.resolve(new Response(bytes, { headers: { "content-type": "image/webp" } })) : real(input, init),
  );
}
afterEach(() => vi.unstubAllGlobals());

/** Creates a demo with this many made-up Players, from the home screen, as a Host would. */
async function demoWith(count: number) {
  const server = await startServer();
  const host = await server.signedIn("host@example.com");
  openApp(host);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /try a demo/i }));
  await user.clear(screen.getByLabelText(/how many players/i));
  await user.type(screen.getByLabelText(/how many players/i), String(count));
  await user.click(screen.getByRole("button", { name: /create demo game/i }));
  await screen.findByRole("button", { name: /start game/i });
  const id = (await host.myGames())[0]!.id;
  return { host, id, game: (await host.game(id))! };
}

describe("A new demo's Feed", () => {
  it("already has what the guests said: a Photo of the gift table, a joke, a reply and Reactions", async () => {
    giftTablePhotoServed();
    const { host, id, game } = await demoWith(6);

    const posts = await host.posts(id);
    expect(posts.map((p) => p.text)).toEqual(
      expect.arrayContaining([
        "The gift table is getting serious 👀",
        "Whoever wrapped a box in duct tape: respect.",
        "That's mine. Good luck getting into it 😈",
        "Fair warning: I'm stealing anything with a snowman on it ⛄",
      ]),
    );
    expect(posts.find((p) => p.text.startsWith("The gift table"))!.photo).not.toBeNull();
    expect(posts.find((p) => p.text.startsWith("That's mine"))!.replyTo).toMatchObject({ author: expect.any(String) });
    expect(posts.flatMap((p) => p.reactions).length).toBeGreaterThan(0);
    // None from the sample phone's own Player, so all of it is new to that phone.
    expect(posts.map((p) => p.author)).not.toContain(game.players[0]!.name);
  });

  it("does without the Photo if it won't load, and still makes the demo", async () => {
    const { host, id } = await demoWith(2);
    const posts = await host.posts(id);
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((p) => p.photo === null)).toBe(true);
  });
});
