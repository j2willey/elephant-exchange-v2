import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { browser, drawInOrder, openApp, startServer } from "./harness.js";

const tinyPng = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);
const cssVar = (name: string) => document.documentElement.style.getPropertyValue(name).trim();

/** A Host who is the Organizer of two Organizations, red and green. */
async function organizer() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const lodge = await host.createOrg("Lodge 22");
  await host.editOrg(lodge, { color: "#c8102e" });
  const troop = await host.createOrg("Troop 7");
  await host.editOrg(troop, { color: "#006400" });
  return { ...server, host, lodge, troop, user: userEvent.setup() };
}

const panel = () => screen.findByRole("region", { name: /how this game looks/i });

describe("A Game's look", () => {
  it("can take an Organization's Theme when the Game is created", async () => {
    const { host, user } = await organizer();
    openApp(host);
    await user.click(await screen.findByRole("button", { name: /new game/i }));

    await screen.findByRole("option", { name: "Lodge 22" }); // once the Organizations have loaded
    await user.selectOptions(screen.getByLabelText(/^organization$/i), "Lodge 22");
    await user.click(screen.getByRole("button", { name: /create game/i }));

    await waitFor(() => expect(cssVar("--brand")).toBe("#c8102e"));
  });

  it("can be switched to another Organization, or none, by the Host at any time", async () => {
    const { host, lodge, user } = await organizer();
    const id = await host.createGame({ activeSlots: 1, maxSteals: 3 }, "Party", "host", undefined, lodge);
    openApp(host, `/games/${id}`);
    await waitFor(() => expect(cssVar("--brand")).toBe("#c8102e"));

    await within(await panel()).findByRole("option", { name: "Troop 7" }); // once the Organizations have loaded
    await user.selectOptions(within(await panel()).getByLabelText(/organization/i), "Troop 7");
    await waitFor(() => expect(cssVar("--brand")).toBe("#006400"));

    await user.selectOptions(within(await panel()).getByLabelText(/organization/i), "None");
    await waitFor(() => expect(cssVar("--brand")).toBe(""));
  });

  it("can have its own colors and logo for this Game only, and hand them back", async () => {
    const { host, lodge, user } = await organizer();
    const id = await host.createGame({ activeSlots: 1, maxSteals: 3 }, "Party", "host", undefined, lodge);
    openApp(host, `/games/${id}`);
    const look = await panel();

    fireEvent.input(within(look).getByLabelText(/main color/i), { target: { value: "#0b3d91" } });
    await user.click(within(look).getByRole("button", { name: /save colors/i }));
    await waitFor(() => expect(cssVar("--brand")).toBe("#0b3d91"));

    await user.upload(within(look).getByLabelText(/^logo/i), new File([tinyPng], "party.png", { type: "image/png" }));
    await waitFor(() => expect(screen.getAllByRole("img", { name: /logo/i })[0]!.getAttribute("src")).toMatch(new RegExp(`^/api/games/${id}/theme/logo`)));

    await user.click(within(look).getByRole("button", { name: /use the organization's main color/i }));
    await waitFor(() => expect(cssVar("--brand")).toBe("#c8102e"));
  });

  it("is only for the Host and Co-hosts to change", async () => {
    const { host, origin, lodge } = await organizer();
    const id = await host.createGame({ activeSlots: 1, maxSteals: 3 }, "Party", "host", undefined, lodge);
    openApp(browser(origin), `/games/${id}`);
    await waitFor(() => expect(cssVar("--brand")).toBe("#c8102e"));
    expect(screen.queryByRole("region", { name: /how this game looks/i })).not.toBeInTheDocument();
  });
});
