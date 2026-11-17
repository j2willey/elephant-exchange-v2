import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { browser, drawInOrder, onTab, openApp, startServer } from "./harness.js";

/** The Host, signed in, creates a Game from the home screen; resolves once its page is showing. */
async function createGame(settings?: { slots?: string; steals?: string }) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /new game/i }));
  if (settings?.slots) {
    await user.clear(screen.getByLabelText(/players taking a turn at once/i));
    await user.type(screen.getByLabelText(/players taking a turn at once/i), settings.slots);
  }
  if (settings?.steals) {
    await user.clear(screen.getByLabelText(/steals before a gift is frozen/i));
    await user.type(screen.getByLabelText(/steals before a gift is frozen/i), settings.steals);
  }
  await user.click(screen.getByRole("button", { name: /create game/i }));
  await screen.findByRole("heading", { name: /players/i });
  return user;
}

async function addPlayers(user: ReturnType<typeof userEvent.setup>, ...names: string[]) {
  for (const name of names) {
    await user.type(screen.getByLabelText(/player's name/i), name);
    await user.click(screen.getByRole("button", { name: /add player/i }));
    await screen.findByText(name);
  }
}

const rosterNames = () =>
  within(screen.getByRole("list", { name: /players/i }))
    .getAllByRole("listitem")
    .map((li) => li.querySelector("[data-name]")?.textContent);

describe("Setting up a Game", () => {
  it("lets a signed-in Host create a Game with its settings", async () => {
    const { signedIn } = await startServer();
    openApp(await signedIn("host@example.com"));

    await createGame({ slots: "2", steals: "2" });

    expect(screen.getByText(/2 players take a turn at once/i)).toBeInTheDocument();
    expect(screen.getByText(/frozen after 2 steals/i)).toBeInTheDocument();
    expect(screen.getByText(/no players yet/i)).toBeInTheDocument();
  });

  it("adds Players by name, in order, and clears the box for the next one", async () => {
    const { signedIn } = await startServer();
    openApp(await signedIn("host@example.com"));
    const user = await createGame();

    await addPlayers(user, "Ann", "Bob", "Cat");

    expect(rosterNames()).toEqual(["Ann", "Bob", "Cat"]);
    expect(screen.getByLabelText(/player's name/i)).toHaveValue("");
  });

  it("removes a Player added by mistake", async () => {
    const { signedIn } = await startServer();
    openApp(await signedIn("host@example.com"));
    const user = await createGame();
    await addPlayers(user, "Ann", "Bobb", "Cat");

    await user.click(screen.getByRole("button", { name: /remove bobb/i }));

    await screen.findByText("Cat");
    expect(screen.queryByText("Bobb")).not.toBeInTheDocument();
    expect(rosterNames()).toEqual(["Ann", "Cat"]);
  });

  it("can't start until there are two Players; starting calls the first Players up", async () => {
    const { signedIn } = await startServer({ draw: drawInOrder });
    openApp(await signedIn("host@example.com"));
    const user = await createGame();
    await addPlayers(user, "Ann");
    expect(screen.getByRole("button", { name: /start game/i })).toBeDisabled();
    expect(screen.getByText(/add at least 2 players to start/i)).toBeInTheDocument();
    await addPlayers(user, "Bob", "Cat");
    expect(screen.queryByText(/add at least 2 players/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /start game/i }));

    expect(await screen.findByText(/up now/i)).toHaveTextContent(/up now:\s*ann/i);
    expect(screen.getByText(/on deck/i)).toHaveTextContent(/on deck:\s*bob/i);
  });

  it("opens on the Host's console: the Players and Start come first, and the settings are a link away", async () => {
    const { signedIn } = await startServer();
    openApp(await signedIn("host@example.com"));
    const user = await createGame();

    const cards = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(cards.indexOf("Players")).toBeLessThan(cards.indexOf("Feed"));
    expect(screen.getByRole("button", { name: /start game/i })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /how this game looks/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /approval/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /end the game/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /settings/i }));
    expect(await screen.findByRole("region", { name: /how this game looks/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /approval/i })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /back to the game/i }));
    expect(await screen.findByRole("button", { name: /start game/i })).toBeInTheDocument();
  });

  it("keeps the settings page to the Host and Co-hosts", async () => {
    const { origin, signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const id = await host.createGame({ activeSlots: 1, maxSteals: 3 });
    openApp(browser(origin), `/games/${id}/settings`);

    expect(await screen.findByText(/only the host/i)).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to the game/i })).toHaveAttribute("href", `/games/${id}`);
  });

  it("shows the same Game after a reload", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const first = openApp(host);
    const user = await createGame();
    await addPlayers(user, "Ann", "Bob");
    const gameLink = screen.getByRole("link", { name: /link to this game/i }).getAttribute("href")!;
    first.unmount();

    openApp(host, gameLink);

    await screen.findByText("Bob");
    expect(rosterNames()).toEqual(["Ann", "Bob"]);
  });

  it("shows anyone else the Players, but none of the Host's controls", async () => {
    const { origin, signedIn } = await startServer();
    const first = openApp(await signedIn("host@example.com"));
    const user = await createGame();
    await addPlayers(user, "Ann");
    const gameLink = screen.getByRole("link", { name: /link to this game/i }).getAttribute("href")!;
    first.unmount();

    openApp(browser(origin), gameLink);
    await onTab(/^you$/i);

    await screen.findByText("Ann");
    expect(screen.queryByLabelText(/player's name/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start game|remove/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /settings/i })).not.toBeInTheDocument();
  });
});
