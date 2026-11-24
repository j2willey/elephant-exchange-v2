import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { invitationText } from "../src/Welcome.js";
import { browser, onTab, openApp, startServer } from "./harness.js";

beforeEach(() => localStorage.clear());

/** A Game not started yet, with When & where, and Ann on the Roster. */
async function party(rosterMode: "self" | "host" = "self") {
  const server = await startServer();
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ name: "Office swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3, rosterMode } });
  await host.setGameOptions(id, { whenWhere: "Fri Dec 12, 10 am · Room B" });
  await host.command(id, { type: "AddPlayer", playerId: "ann", name: "Ann" });
  return { ...server, host, id, user: userEvent.setup() };
}

/** Back in the Game from the emailed link (past the "Signing in" page), on the You tab. */
async function onYouTab() {
  await screen.findByRole("tab", { name: /^you$/i });
  await onTab(/^you$/i);
}

const welcomeForm = () => screen.findByRole("form", { name: /join this game/i });

async function fillIn(user: ReturnType<typeof userEvent.setup>, { name, email, gift }: { name: string; email: string; gift: boolean }) {
  const form = await welcomeForm();
  await user.type(within(form).getByLabelText(/your name/i), name);
  await user.type(within(form).getByLabelText(/email/i), email);
  if (gift) await user.click(within(form).getByRole("checkbox", { name: /i brought a gift/i }));
  await user.click(within(form).getByRole("button", { name: /email me a link/i }));
  expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
}

describe("The welcome screen on a Game's link", () => {
  it("greets someone new with the Game, When & where, and a way to join or just watch", async () => {
    const { origin, id, user } = await party();
    const phone = browser(origin);
    const first = openApp(phone, `/games/${id}`, { welcome: true });

    expect(await screen.findByRole("heading", { name: "Office swap" })).toBeInTheDocument();
    expect(screen.getByText(/fri dec 12, 10 am · room b/i)).toBeInTheDocument();
    const form = await welcomeForm();
    expect(within(form).getByLabelText(/email/i)).toBeInTheDocument();
    expect(within(form).getByRole("checkbox", { name: /i brought a gift/i })).not.toBeChecked();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /just watch/i }));
    expect(await screen.findByRole("tab", { name: /gifts/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /playing\? join the game/i })).toBeInTheDocument();
    first.unmount();

    // Coming back on this phone, they go straight to the Game.
    openApp(phone, `/games/${id}`, { welcome: true });
    expect(await screen.findByRole("tab", { name: /gifts/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /just watch/i })).not.toBeInTheDocument();
  });

  it("brings someone who brought a gift back from the emailed link as a Player, waiting for the start", async () => {
    const { origin, id, user, linkFor, host } = await party();
    const phone = browser(origin);
    const first = openApp(phone, `/games/${id}`, { welcome: true });
    await fillIn(user, { name: "Eve", email: "eve@example.com", gift: true });
    first.unmount();

    openApp(phone, linkFor("eve@example.com"));
    const status = await screen.findByRole("status", { name: /who's up/i });
    await waitFor(() => expect(status).toHaveTextContent(/waiting for the host to start · 2 players/i));
    await onYouTab();
    expect(await screen.findByText(/you're playing as eve/i)).toBeInTheDocument();
    await waitFor(async () => expect((await host.game(id))?.players.map((p) => p.name)).toEqual(["Ann", "Eve"]));
  });

  it("brings someone without a gift back as a Guest who can post, not a Player", async () => {
    const { origin, id, user, linkFor, host } = await party();
    const phone = browser(origin);
    const first = openApp(phone, `/games/${id}`, { welcome: true });
    await fillIn(user, { name: "Gil", email: "gil@example.com", gift: false });
    first.unmount();

    openApp(phone, linkFor("gil@example.com"));
    await onYouTab();
    expect(await screen.findByText(/you're posting as gil/i)).toBeInTheDocument();
    expect((await host.game(id))?.players.map((p) => p.name)).toEqual(["Ann"]);
  });

  it("in a Host-entered Game, makes the gift box ask the Host to add them, and comes back from the link asking", async () => {
    const { origin, id, user, linkFor, host } = await party("host");
    const phone = browser(origin);
    const first = openApp(phone, `/games/${id}`, { welcome: true });
    const form = await welcomeForm();
    expect(within(form).getByRole("checkbox", { name: /ask the host to add me as a player/i })).toBeInTheDocument();
    expect(within(form).getByText(/on the host's guest list already/i)).toBeInTheDocument();
    await fillIn(user, { name: "Gil", email: "gil@example.com", gift: true });
    first.unmount();

    openApp(phone, linkFor("gil@example.com"));
    await onYouTab();
    expect(await screen.findByText(/you've asked to play/i)).toBeInTheDocument();
    expect(await screen.findByText(/you're posting as gil/i)).toBeInTheDocument();
    expect((await host.askingToPlay(id)).map((a) => a.name)).toEqual(["Gil"]);
  });

  it("gets the Host their console when they sign in from the welcome screen on another device", async () => {
    const { origin, id, user, linkFor } = await party();
    const phone = browser(origin);
    const first = openApp(phone, `/games/${id}`, { welcome: true });
    await fillIn(user, { name: "Hal", email: "host@example.com", gift: false });
    first.unmount();

    openApp(phone, linkFor("host@example.com"));
    expect(await screen.findByRole("button", { name: /start game/i })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /join this game/i })).not.toBeInTheDocument();
  });

  it("asks someone already signed in only their name, and joins them at once", async () => {
    const { signedIn, id, user } = await party();
    openApp(await signedIn("dan@example.com"), `/games/${id}`, { welcome: true });
    const form = await welcomeForm();
    expect(within(form).queryByLabelText(/email/i)).not.toBeInTheDocument();
    await user.type(within(form).getByLabelText(/your name/i), "Dan");
    await user.click(within(form).getByRole("checkbox", { name: /i brought a gift/i }));
    await user.click(within(form).getByRole("button", { name: /join as a player/i }));
    await onYouTab();
    expect(await screen.findByText(/you're playing as dan/i)).toBeInTheDocument();
  });
});

describe("The invitation a Host copies", () => {
  it("has the Game, When & where and its link, and keeps phones optional", () => {
    const text = invitationText({ id: "g1", name: "Office swap", tagline: "Ugly sweaters encouraged", whenWhere: "Fri Dec 12, 10 am · Room B", rosterMode: "self" }, "https://ee.example");
    expect(text).toContain("You're invited: Office swap");
    expect(text).toContain("Ugly sweaters encouraged");
    expect(text).toContain("Fri Dec 12, 10 am · Room B");
    expect(text).toContain("sign up as a Player ahead of time");
    expect(text).toContain("on your phone if you like");
    expect(text.trim().endsWith("https://ee.example/games/g1")).toBe(true);
    expect(text).not.toMatch(/need|must|required/i);
  });

  it("leaves out what the Host hasn't set, and sign-up in a Host-entered Game", () => {
    const text = invitationText({ id: "g1", name: "Office swap", tagline: "", whenWhere: "", rosterMode: "host" }, "https://ee.example");
    expect(text.split("\n")[1]).toBe("");
    expect(text).not.toContain("sign up");
  });
});
