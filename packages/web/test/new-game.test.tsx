import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { openApp, startServer } from "./harness.js";

/** The Host's newest Game, as the server has it. */
const newest = async (host: { myGames: () => Promise<{ id: string }[]>; game: (id: string) => Promise<unknown> }) => host.game((await host.myGames())[0]!.id);

async function newGame() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /new game/i }));
  return user;
}

describe("Starting a new Game", () => {
  it("offers a first-time Host the recommended settings or the full list", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    openApp(host);
    const user = await newGame();

    expect(screen.queryByLabelText(/players taking a turn at once/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /use recommended settings/i }));

    await screen.findByRole("heading", { name: /players/i });
    expect(await newest(host)).toMatchObject({
      settings: { activeSlots: 1, maxSteals: 3 },
      clock: { turnSeconds: 60 },
      rosterMode: "host",
      approveNames: false,
      moderation: "open",
    });
  });

  it("lists every option with the recommended values filled in, each explained under its ⓘ", async () => {
    const { signedIn } = await startServer();
    openApp(await signedIn("host@example.com"));
    const user = await newGame();
    await user.click(screen.getByRole("button", { name: /customize settings/i }));

    expect(screen.getByLabelText(/players taking a turn at once/i)).toHaveValue(1);
    expect(screen.getByLabelText(/steals before a gift is frozen/i)).toHaveValue(3);
    expect(screen.getByLabelText(/seconds per turn/i)).toHaveValue(60);
    expect(screen.getByRole("radio", { name: /i'll enter them/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /approve names/i })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /open: posts appear at once/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /always start with these settings/i })).not.toBeChecked();

    const infos = screen.getAllByRole("button", { name: /what's this for/i });
    expect(infos).toHaveLength(6);
    expect(screen.queryByText(/2 or 3/)).not.toBeInTheDocument();
    await user.click(infos[0]!);
    expect(infos[0]).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/keeps the party moving/i)).toBeInTheDocument();
    await user.click(infos[0]!);
    expect(screen.queryByText(/keeps the party moving/i)).not.toBeInTheDocument();
  });

  it("creates the Game with the options chosen, including approving names and the Feed's posting rule", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    openApp(host);
    const user = await newGame();
    await user.click(screen.getByRole("button", { name: /customize settings/i }));
    await user.clear(screen.getByLabelText(/players taking a turn at once/i));
    await user.type(screen.getByLabelText(/players taking a turn at once/i), "2");
    await user.click(screen.getByRole("checkbox", { name: /approve names/i }));
    await user.click(screen.getByRole("radio", { name: /approval: each post waits/i }));
    await user.click(screen.getByRole("button", { name: /create the game/i }));

    await screen.findByRole("heading", { name: /players/i });
    expect(await newest(host)).toMatchObject({ settings: { activeSlots: 2 }, approveNames: true, moderation: "approval" });
    // Not ticked: nothing saved, so the next New Game asks again.
    expect(await host.session()).toMatchObject({ alwaysMyOptions: false, myOptions: null });
  });

  it("with \"Always start with these settings\" ticked, the next New Game creates with them in one tap", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    openApp(host);
    let user = await newGame();
    await user.click(screen.getByRole("button", { name: /customize settings/i }));
    await user.clear(screen.getByLabelText(/seconds per turn/i));
    await user.type(screen.getByLabelText(/seconds per turn/i), "120");
    await user.click(screen.getByRole("checkbox", { name: /always start with these settings/i }));
    await user.click(screen.getByRole("button", { name: /create the game/i }));
    await screen.findByRole("heading", { name: /players/i });

    cleanup();
    openApp(host); // home again, as on another visit
    user = await newGame();
    expect(screen.queryByRole("button", { name: /use recommended settings/i })).not.toBeInTheDocument();
    expect(screen.getByText(/your settings: .*120-second timer/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /create the game/i }));

    await screen.findByRole("heading", { name: /players/i });
    expect(await newest(host)).toMatchObject({ clock: { turnSeconds: 120 } });
  });

  it("lets a returning Host change their saved settings, or stop using them", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    await host.createGame({
      options: { activeSlots: 2, maxSteals: 2, turnSeconds: 90, rosterMode: "self", approveNames: false, moderation: "open" },
      start: "customized",
      remember: true,
    });
    openApp(host);
    const user = await newGame();

    await user.click(screen.getByRole("button", { name: /change my settings/i }));
    expect(screen.getByLabelText(/seconds per turn/i)).toHaveValue(90);
    expect(screen.getByRole("radio", { name: /players sign up on their phones/i })).toBeChecked();
    const always = screen.getByRole("checkbox", { name: /always start with these settings/i });
    expect(always).toBeChecked();

    await user.click(always);
    await user.click(screen.getByRole("button", { name: /create the game/i }));
    await screen.findByRole("heading", { name: /players/i });
    expect(await host.session()).toMatchObject({ alwaysMyOptions: false });
  });

  it("can go back to the recommended settings from the full list", async () => {
    const { signedIn } = await startServer();
    openApp(await signedIn("host@example.com"));
    const user = await newGame();
    await user.click(screen.getByRole("button", { name: /customize settings/i }));
    await user.clear(screen.getByLabelText(/steals before a gift is frozen/i));
    await user.type(screen.getByLabelText(/steals before a gift is frozen/i), "5");

    await user.click(screen.getByRole("button", { name: /back to the recommended settings/i }));

    expect(screen.getByLabelText(/steals before a gift is frozen/i)).toHaveValue(3);
  });
});

describe("The Host's Guide, up front", () => {
  it("is offered on the home screen and in New Game, every time", async () => {
    const { signedIn } = await startServer();
    openApp(await signedIn("host@example.com"));

    expect(await screen.findByRole("link", { name: /read the host's guide/i })).toHaveAttribute("href", "/guide");
    await newGame();
    expect(within(screen.getByRole("heading", { name: /new game/i }).closest("form")!).getByRole("link", { name: /host's guide/i })).toBeInTheDocument();
  });

  it("is pointed out on the console until the Game starts", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    openApp(host);
    const user = await newGame();
    await user.click(screen.getByRole("button", { name: /use recommended settings/i }));

    expect(await screen.findByText(/before the party: the/i)).toBeInTheDocument();
  });
});
