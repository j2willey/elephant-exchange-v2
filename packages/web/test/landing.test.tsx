import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { browser, openApp, startServer } from "./harness.js";

describe("The landing page", () => {
  it("tells a visitor what the app is, each problem it helps with beside how, and how it works, with the ways in", async () => {
    const { origin } = await startServer();
    openApp(browser(origin));

    const hero = await screen.findByRole("region", { name: /what it is/i });
    expect(hero).toHaveTextContent(/white elephant gift swap/i);
    expect(within(hero).getByRole("link", { name: /^try a demo$/i })).toHaveAttribute("href", "/try");
    expect(within(hero).getByRole("link", { name: /^create a new game$/i })).toHaveAttribute("href", "/login");
    expect(within(hero).getByRole("link", { name: /enter your code/i })).toHaveAttribute("href", "/join");

    // Each problem in the same row as its answer.
    const rows = within(screen.getByRole("region", { name: /sound familiar/i })).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/wanders the room.*turns move faster/i),
      expect.stringMatching(/from the back.*photos and chatter/i),
      expect.stringMatching(/stolen twice.*keeps track of the rules/i),
      expect.stringMatching(/drifted off.*whole room stays in it/i),
    ]);
    expect(screen.getByRole("region", { name: /sound familiar/i })).toHaveTextContent(/nothing to install/i);
    expect(screen.getByRole("region", { name: /how it works/i })).toHaveTextContent(/create a game.*scoreboard on the big screen.*call names/i);
    expect(screen.getByRole("link", { name: /read the host's guide/i })).toHaveAttribute("href", "/guide");
    expect(screen.getByRole("link", { name: /three things to do before the party/i })).toHaveAttribute("href", "/guide#before-the-party");
  });

  it("leaves the rest to other pages: no sample scoreboard, sign-in form, code box or note from Jim on it", async () => {
    const { origin } = await startServer();
    openApp(browser(origin));
    await screen.findByRole("region", { name: /what it is/i });

    expect(screen.queryByRole("img", { name: /scoreboard on the party's big screen/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /open a game/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /a note from jim/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /about elephant exchange/i })).toHaveAttribute("href", "/about");
  });

  it("has the same two start buttons as a signed-in Host's home, in the same order and colors; only the ▶ moves", async () => {
    const { origin, signedIn } = await startServer();
    openApp(browser(origin));
    const signedOut = within(await screen.findByRole("region", { name: /what it is/i })).getAllByRole("link", { name: /new game|demo/i });
    expect(signedOut.map((b) => [b.textContent, b.classList.contains("secondary-button")])).toEqual([
      ["Create a New Game", false],
      ["▶ Try a Demo", true],
    ]);
    cleanup();

    openApp(await signedIn("host@example.com"));
    await screen.findByRole("button", { name: /^create a new game$/i });
    const home = screen.getAllByRole("button", { name: /^(create a new game|try a demo)$/i });
    expect(home.map((b) => [b.textContent, b.classList.contains("secondary")])).toEqual([
      ["▶ Create a New Game", false],
      ["Try a Demo", true],
    ]);
  });

  it("sends Create a New Game to signing in", async () => {
    const { origin } = await startServer();
    openApp(browser(origin));
    await userEvent.setup().click(await screen.findByRole("link", { name: /^create a new game$/i }));

    expect(await screen.findByRole("heading", { name: /sign in to host a game/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  });

  for (const [what, typed] of [
    ["the link", (origin: string, id: string) => `${origin}/games/${id}`],
    ["the code", (_: string, id: string) => ` ${id} `],
  ] as const) {
    it(`opens a Game from ${what} the Host sent`, async () => {
      const { origin, signedIn } = await startServer();
      const host = await signedIn("host@example.com");
      const id = await host.createGame({ name: "Acme Holiday Party", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
      const user = userEvent.setup();
      openApp(browser(origin));

      await user.click(await screen.findByRole("link", { name: /enter your code/i }));
      const join = await screen.findByRole("form", { name: /open a game/i });
      await user.type(within(join).getByLabelText(/game link or code/i), typed("http://localhost:3000", id));
      await user.click(within(join).getByRole("button", { name: /open/i }));

      expect(await screen.findByText(/acme holiday party/i)).toBeInTheDocument();
    });
  }

  it("links a signed-in Host to the Guide too", async () => {
    const { signedIn } = await startServer();
    openApp(await signedIn("host@example.com"));
    await screen.findByRole("button", { name: /show my email/i });
    expect(screen.getByRole("link", { name: /host's guide/i })).toHaveAttribute("href", "/guide");
  });
});

describe("The Host's Guide", () => {
  it("covers setting up, the room, running the Game and the vote, for anyone, signed in or not", async () => {
    const { origin } = await startServer();
    openApp(browser(origin), "/guide");

    expect(await screen.findByRole("heading", { level: 2, name: /host's guide/i })).toBeInTheDocument();
    for (const section of [/before the party/i, /the room/i, /running the game/i, /worst gift vote/i]) {
      expect(screen.getByRole("heading", { level: 3, name: section })).toBeInTheDocument();
    }
    expect(screen.getByRole("main")).toHaveTextContent(/no take-backs/i);
    expect(screen.getByRole("main")).toHaveTextContent(/ready-made looks/i);
    expect(screen.getByRole("link", { name: /start a game/i })).toHaveAttribute("href", "/");
  });
});

describe("The tip jar", () => {
  const tipLink = () => within(screen.getByRole("region", { name: /a note from jim/i })).getByRole("link", { name: /leave a tip/i });

  it("asks, with no strings, on the About page, the Guide and the Host's home, linking to Ko-fi in a new tab", async () => {
    const { origin, signedIn } = await startServer();
    openApp(browser(origin), "/about");
    await screen.findByRole("heading", { name: /about elephant exchange/i });
    expect(screen.getByRole("region", { name: /a note from jim/i })).toHaveTextContent(/100 sign-in emails a day.*no strings/i);
    expect(tipLink()).toHaveAttribute("href", "https://ko-fi.com/jimwilley");
    expect(tipLink()).toHaveAttribute("target", "_blank");
    expect(tipLink()).toHaveAttribute("rel", expect.stringContaining("noopener"));
    cleanup();

    openApp(browser(origin), "/guide");
    await screen.findByRole("heading", { name: /host's guide/i });
    expect(tipLink()).toHaveAttribute("href", "https://ko-fi.com/jimwilley");
    cleanup();

    // On the Host's home, just the link, at the foot by itself: the note itself comes with their first New Game.
    openApp(await signedIn("host@example.com"));
    await screen.findByRole("button", { name: /new game/i });
    expect(screen.queryByRole("region", { name: /a note from jim/i })).not.toBeInTheDocument();
    const homeTip = within(screen.getByRole("contentinfo", { name: /about you/i })).getByRole("link", { name: /leave a tip/i });
    expect(homeTip).toHaveAttribute("href", "https://ko-fi.com/jimwilley");
    expect(homeTip).toHaveAttribute("target", "_blank");
  });

  it("is never shown in a Game", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const id = await host.createGame({ name: "Acme Holiday Party", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    openApp(host, `/games/${id}`);
    await screen.findByText(/acme holiday party/i);

    expect(screen.queryByRole("region", { name: /a note from jim/i })).not.toBeInTheDocument();
  });
});

describe("Trying the demo from the front page", () => {
  it("needs no sign-in: a visitor picks how many guests and is in the demo Game, then home lists it and offers to host a real one", async () => {
    const { origin } = await startServer();
    const user = userEvent.setup();
    const visitor = browser(origin);
    openApp(visitor, "/try");

    expect(await screen.findByText(/no sign-up/i)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /create demo game/i }));
    expect(await screen.findByRole("heading", { name: "Demo game" }, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByText(/start game/i)).toBeInTheDocument();

    cleanup();
    openApp(visitor, "/");
    expect(await screen.findByText(/you're trying the demo/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /host your own party/i })).toBeInTheDocument(); // the sign-in form
    expect(within(await screen.findByRole("list", { name: /your games/i })).getByText("Demo game")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^new game$/i })).not.toBeInTheDocument();
  });

  it("goes straight to the demo's one question for someone signed in", async () => {
    const { signedIn } = await startServer();
    openApp(await signedIn("host@example.com"), "/try");

    expect(await screen.findByLabelText(/how many players/i)).toBeInTheDocument();
  });
});

describe("The Guide's old address", () => {
  it("still opens it, for links already shared", async () => {
    const { origin } = await startServer();
    openApp(browser(origin), "/playbook");
    expect(await screen.findByRole("heading", { level: 2, name: /host's guide/i })).toBeInTheDocument();
  });
});
