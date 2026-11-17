import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { drawInOrder, openApp, startServer } from "./harness.js";

async function hosting() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ activeSlots: 1, maxSteals: 3 }, "Gift exchange");
  return { ...server, host, id, user: userEvent.setup() };
}

describe("The Host's console", () => {
  it("says what it is, and offers the scoreboard (in a new tab, for the TV), the guests' link and Settings", async () => {
    const { host, id } = await hosting();
    openApp(host, `/games/${id}`);

    expect(await screen.findByText(/host console/i)).toBeInTheDocument();
    const scoreboard = screen.getByRole("link", { name: /open the scoreboard/i });
    expect(scoreboard).toHaveAttribute("href", `/games/${id}/screen`);
    expect(scoreboard).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: /link for guests/i })).toHaveAttribute("href", `/games/${id}`);
    expect(screen.getByRole("link", { name: /settings/i })).toHaveAttribute("href", `/games/${id}/settings`);
  });
});

describe("A Game's options, on its Settings", () => {
  const options = () => screen.findByRole("region", { name: /game options/i });

  it("start as the Game was created", async () => {
    const { host, id } = await hosting();
    openApp(host, `/games/${id}/settings`);
    const card = await options();

    expect(within(card).getByLabelText(/name of the game/i)).toHaveValue("Gift exchange");
    expect(within(card).getByLabelText(/players taking a turn at once/i)).toHaveValue(1);
    expect(within(card).getByLabelText(/steals before a gift is frozen/i)).toHaveValue(3);
    expect(within(card).getByLabelText(/seconds per turn/i)).toHaveValue(60);
    expect(within(card).getByRole("radio", { name: /i'll enter them/i })).toBeChecked();
  });

  it("can all be changed, and the console shows them", async () => {
    const { host, id, user } = await hosting();
    openApp(host, `/games/${id}/settings`);
    const card = await options();

    const name = within(card).getByLabelText(/name of the game/i);
    await user.clear(name);
    await user.type(name, "OA Holiday Party");
    fireEvent.change(within(card).getByLabelText(/players taking a turn at once/i), { target: { value: "2" } });
    fireEvent.change(within(card).getByLabelText(/steals before a gift is frozen/i), { target: { value: "2" } });
    fireEvent.change(within(card).getByLabelText(/seconds per turn/i), { target: { value: "90" } });
    await user.click(within(card).getByRole("radio", { name: /players sign up on their phones/i }));
    await user.click(within(card).getByRole("button", { name: /save options/i }));
    expect(await within(card).findByText(/saved/i)).toBeInTheDocument();

    await waitFor(async () =>
      expect(await host.game(id)).toMatchObject({ name: "OA Holiday Party", rosterMode: "self", settings: { activeSlots: 2, maxSteals: 2 }, clock: { turnSeconds: 90 } }),
    );
    await user.click(screen.getByRole("link", { name: /back to the game/i }));
    expect(await screen.findByRole("heading", { name: "OA Holiday Party" })).toBeInTheDocument();
    expect(screen.getByText(/2 players take a turn at once/i)).toHaveTextContent(/frozen after 2 steals/i);
  });
});

describe("The home screen", () => {
  it("doesn't let creating an Organization pass for creating a Game", async () => {
    const { host } = await hosting();
    openApp(host);

    const orgs = await screen.findByRole("region", { name: /your organizations/i });
    expect(within(orgs).getByText(/optional/i)).toBeInTheDocument();
    expect(within(orgs).getByRole("button", { name: /^create organization$/i })).toBeInTheDocument();
  });
});
