import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { browser, openApp, startServer } from "./harness.js";

describe("The landing page", () => {
  it("tells a visitor what the app is for, with sign-in to host a Game and the Host's Playbook", async () => {
    const { origin } = await startServer();
    openApp(browser(origin));

    const hero = await screen.findByRole("region", { name: /what it is/i });
    expect(hero).toHaveTextContent(/white elephant/i);
    expect(screen.getByRole("heading", { name: /speed up the game/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /keep everyone in it/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /the rules, kept for you/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /host's playbook/i })).toHaveAttribute("href", "/playbook");
  });

  for (const [what, typed] of [
    ["the link", (origin: string, id: string) => `${origin}/games/${id}`],
    ["the code", (_: string, id: string) => ` ${id} `],
  ] as const) {
    it(`opens a Game from ${what} the Host sent`, async () => {
      const { origin, signedIn } = await startServer();
      const host = await signedIn("host@example.com");
      const id = await host.createGame({ activeSlots: 1, maxSteals: 3 }, "Acme Holiday Party");
      const user = userEvent.setup();
      openApp(browser(origin));

      const join = await screen.findByRole("form", { name: /open a game/i });
      await user.type(within(join).getByLabelText(/game link or code/i), typed("http://localhost:3000", id));
      await user.click(within(join).getByRole("button", { name: /open/i }));

      expect(await screen.findByText(/acme holiday party/i)).toBeInTheDocument();
    });
  }

  it("links a signed-in Host to the Playbook too", async () => {
    const { signedIn } = await startServer();
    openApp(await signedIn("host@example.com"));
    await screen.findByText(/signed in as/i);
    expect(screen.getByRole("link", { name: /host's playbook/i })).toHaveAttribute("href", "/playbook");
  });
});

describe("The Host's Playbook", () => {
  it("covers setting up, the room, running the Game and the vote, for anyone, signed in or not", async () => {
    const { origin } = await startServer();
    openApp(browser(origin), "/playbook");

    expect(await screen.findByRole("heading", { level: 2, name: /host's playbook/i })).toBeInTheDocument();
    for (const section of [/before the party/i, /the room/i, /running the game/i, /worst gift vote/i]) {
      expect(screen.getByRole("heading", { level: 3, name: section })).toBeInTheDocument();
    }
    expect(screen.getByRole("main")).toHaveTextContent(/no take-backs/i);
    expect(screen.getByRole("link", { name: /start a game/i })).toHaveAttribute("href", "/");
  });
});

describe("The tip jar", () => {
  const tipLink = () => within(screen.getByRole("region", { name: /a note from jim/i })).getByRole("link", { name: /leave a tip/i });

  it("asks, with no strings, on the landing page, the Playbook and the Host's home, linking to Ko-fi in a new tab", async () => {
    const { origin, signedIn } = await startServer();
    openApp(browser(origin));
    await screen.findByRole("region", { name: /what it is/i });
    expect(screen.getByRole("region", { name: /a note from jim/i })).toHaveTextContent(/100 sign-in emails a day.*no strings/i);
    expect(tipLink()).toHaveAttribute("href", "https://ko-fi.com/jimwilley");
    expect(tipLink()).toHaveAttribute("target", "_blank");
    expect(tipLink()).toHaveAttribute("rel", expect.stringContaining("noopener"));
    cleanup();

    openApp(browser(origin), "/playbook");
    await screen.findByRole("heading", { name: /host's playbook/i });
    expect(tipLink()).toHaveAttribute("href", "https://ko-fi.com/jimwilley");
    cleanup();

    openApp(await signedIn("host@example.com"));
    await screen.findByRole("button", { name: /new game/i });
    expect(tipLink()).toHaveAttribute("href", "https://ko-fi.com/jimwilley");
  });

  it("is never shown in a Game", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const id = await host.createGame({ activeSlots: 1, maxSteals: 3 }, "Acme Holiday Party");
    openApp(host, `/games/${id}`);
    await screen.findByText(/acme holiday party/i);

    expect(screen.queryByRole("region", { name: /a note from jim/i })).not.toBeInTheDocument();
  });
});
