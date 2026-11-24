import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { playersFrom } from "../src/RosterPaste.js";
import { browser, onTab, openApp, startServer } from "./harness.js";

beforeEach(() => localStorage.clear());

describe("A pasted guest list", () => {
  it("takes an email after a name, in the ways people write them, or an email alone", () => {
    const { players, skipped } = playersFrom(
      ["1. Ann Lee, Ann.Lee@corp.example", "- Bob Jones <bob@corp.example>", "Cat Cole\tcat@corp.example\tSales", "dan.di-marco@corp.example", "Eve", "Ann Lee", "Al, ann.lee@corp.example"].join("\n"),
      [],
    );
    expect(players).toEqual([
      { name: "Ann Lee", email: "ann.lee@corp.example" },
      { name: "Bob Jones", email: "bob@corp.example" },
      { name: "Cat Cole", email: "cat@corp.example" },
      { name: "Dan Di Marco", email: "dan.di-marco@corp.example" },
      { name: "Eve" },
    ]);
    expect(skipped).toBe(2); // Ann Lee again, and her email again
  });
});

describe("The guest list on the Host's console", () => {
  async function hosting() {
    const server = await startServer();
    const host = await server.signedIn("host@example.com");
    const id = await host.createGame({ name: "Office swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    return { ...server, host, id, user: userEvent.setup() };
  }

  it("adds pasted Players with their emails, and shows when each one is in", async () => {
    const { host, id, user, origin, linkFor } = await hosting();
    openApp(host, `/games/${id}`);
    await user.click(await screen.findByRole("button", { name: /paste a list/i }));
    await user.type(screen.getByLabelText(/names, one per line/i), "Ann Lee, ann@corp.example\nBob");
    await user.click(screen.getByRole("button", { name: /add 2 players/i }));
    expect(await screen.findByText("not yet")).toHaveAttribute("title", "ann@corp.example");
    cleanup();

    // Ann follows the shared link on her own phone and signs in with that email: she's Ann, though it's a
    // Host-entered Game.
    localStorage.clear(); // a different phone from the Host's
    const phone = browser(origin);
    const first = openApp(phone, `/games/${id}`, { welcome: true });
    const form = await screen.findByRole("form", { name: /join this game/i });
    await user.type(within(form).getByLabelText(/your name/i), "Annie");
    await user.type(within(form).getByLabelText(/email/i), "ann@corp.example");
    await user.click(within(form).getByRole("button", { name: /email me a link/i }));
    await screen.findByText(/check your email/i);
    first.unmount();
    openApp(phone, linkFor("ann@corp.example"));
    await screen.findByRole("tab", { name: /^you$/i });
    await onTab(/^you$/i);
    expect(await screen.findByText(/you're playing as ann lee/i)).toBeInTheDocument();
    cleanup();

    openApp(host, `/games/${id}`);
    expect(await screen.findByText("✓ in")).toHaveAttribute("title", "ann@corp.example");
  });

  it("lets the Host give a typed-in Player an email, and says when it's already someone else's", async () => {
    const { host, id, user } = await hosting();
    await host.command(id, { type: "AddPlayer", playerId: "cat", name: "Cat" });
    await host.addGuest(id, "Dan", "dan@corp.example");
    openApp(host, `/games/${id}`);

    await user.click(await screen.findByRole("button", { name: "Add Cat's email" }));
    const form = screen.getByRole("form", { name: "Cat's email" });
    await user.type(within(form).getByLabelText(/email/i), "dan@corp.example");
    await user.click(within(form).getByRole("button", { name: /save/i }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(/already dan's/i);

    await user.clear(within(form).getByLabelText(/email/i));
    await user.type(within(form).getByLabelText(/email/i), "cat@corp.example");
    await user.click(within(form).getByRole("button", { name: /save/i }));
    await waitFor(() => expect(screen.getAllByText("not yet").map((m) => m.title)).toContain("cat@corp.example"));
    expect(screen.getByRole("button", { name: "Change Cat's email" })).toBeInTheDocument();
  });

  it("isn't shown to guests", async () => {
    const { host, id, origin } = await hosting();
    await host.addGuest(id, "Dan", "dan@corp.example");
    openApp(browser(origin), `/games/${id}`);
    await onTab(/^you$/i);
    await screen.findByText("Dan");
    expect(screen.queryByText("not yet")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(add|change) .*'s email$/i })).not.toBeInTheDocument();
  });
});
