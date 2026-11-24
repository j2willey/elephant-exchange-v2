import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { browser, onTab, openApp, startServer } from "./harness.js";

beforeEach(() => localStorage.clear());

async function party() {
  const server = await startServer();
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ name: "Office swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
  await host.addGuest(id, "Ann Lee", "ann@corp.example");
  await host.addGuest(id, "Bob", "bob@corp.example");
  return { ...server, host, id, user: userEvent.setup() };
}

describe("Personal invitations", () => {
  it("are emailed from the Host's console to everyone on the guest list not invited yet", async () => {
    const { host, id, user, invitationFor } = await party();
    openApp(host, `/games/${id}`);

    await user.click(await screen.findByRole("button", { name: /email invitations \(2 not invited yet\)/i }));
    expect(screen.getByText(/may land in spam/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    expect(await screen.findByText("Sent 2 invitations.")).toBeInTheDocument();
    expect(invitationFor("ann@corp.example")).toMatch(/^\/invite\?token=/);
    expect(await screen.findAllByText("✉ invited")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /email invitations/i })).not.toBeInTheDocument();
  });

  it("can be sent to one person from their email form", async () => {
    const { host, id, user, invitationFor } = await party();
    openApp(host, `/games/${id}`);
    await user.click(await screen.findByRole("button", { name: "Change Bob's email" }));
    await user.click(screen.getByRole("button", { name: /email an invitation/i }));
    expect(await screen.findByText(/invitation sent to bob@corp.example/i)).toBeInTheDocument();
    expect(invitationFor("bob@corp.example")).toBeTruthy();
    expect(() => invitationFor("ann@corp.example")).toThrow();
  });

  it("take their person straight to the Game as their Player, and only once", async () => {
    const { host, id, origin, invitationFor, linkFor } = await party();
    await host.sendInvitations(id);
    const invitation = invitationFor("ann@corp.example");

    openApp(browser(origin), invitation);
    await screen.findByRole("tab", { name: /^you$/i });
    await onTab(/^you$/i);
    expect(await screen.findByText(/you're playing as ann lee/i)).toBeInTheDocument();
    cleanup();

    // Opened again, on another device (or forwarded): nobody is signed in, but its owner can get a sign-in link.
    const other = browser(origin);
    openApp(other, invitation);
    expect(await screen.findByRole("heading", { name: /opened already/i })).toBeInTheDocument();
    expect(screen.getByText("an…@corp.example")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /email me a sign-in link/i }));
    expect(await screen.findByText(/sent\. tap the link/i)).toBeInTheDocument();
    cleanup();

    openApp(other, linkFor("ann@corp.example"));
    await screen.findByRole("tab", { name: /^you$/i });
    await onTab(/^you$/i);
    expect(await screen.findByText(/you're playing as ann lee/i)).toBeInTheDocument();
  });

  it("say so when they've expired", async () => {
    const { origin } = await party();
    openApp(browser(origin), "/invite?token=nonsense");
    expect(await screen.findByRole("heading", { name: /expired/i })).toBeInTheDocument();
  });
});
