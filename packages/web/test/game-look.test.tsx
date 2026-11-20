import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    await user.click(screen.getByRole("button", { name: /use recommended settings/i }));

    await waitFor(() => expect(cssVar("--brand")).toBe("#c8102e"));
  });

  it("can be switched to another Organization, or none, by the Host at any time", async () => {
    const { host, lodge, user } = await organizer();
    const id = await host.createGame({ name: "Party", orgId: lodge, options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3, rosterMode: "host" } });
    openApp(host, `/games/${id}/settings`);
    await waitFor(() => expect(cssVar("--brand")).toBe("#c8102e"));

    await within(await panel()).findByRole("option", { name: "Troop 7" }); // once the Organizations have loaded
    await user.selectOptions(within(await panel()).getByLabelText(/organization/i), "Troop 7");
    await waitFor(() => expect(cssVar("--brand")).toBe("#006400"));

    await user.selectOptions(within(await panel()).getByLabelText(/organization/i), "None");
    await waitFor(() => expect(cssVar("--brand")).toBe(""));
  });

  it("can have its own colors and logo for this Game only, and hand them back", async () => {
    const { host, lodge, user } = await organizer();
    const id = await host.createGame({ name: "Party", orgId: lodge, options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3, rosterMode: "host" } });
    openApp(host, `/games/${id}/settings`);
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
    const id = await host.createGame({ name: "Party", orgId: lodge, options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3, rosterMode: "host" } });
    openApp(browser(origin), `/games/${id}`);
    await waitFor(() => expect(cssVar("--brand")).toBe("#c8102e"));
    expect(screen.queryByRole("region", { name: /how this game looks/i })).not.toBeInTheDocument();
  });
});

/**
 * The app's own party photo, as the browser would fetch it from the build; anything else goes on to the server.
 * `found: false` is the photo failing to load (a dropped connection, say).
 */
function partyPhotoServed(found = true) {
  const real = globalThis.fetch;
  const bytes = readFileSync(join(import.meta.dirname, "../src/assets/landing-party.webp"));
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes("landing-party")
      ? Promise.resolve(found ? new Response(bytes, { headers: { "content-type": "image/webp" } }) : new Response("gone", { status: 404 }))
      : real(input, init),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe("The ready-made party photo", () => {
  it("becomes the Game's background in one tap, for a Host without a photo of their own", async () => {
    partyPhotoServed();
    const { host, user } = await organizer();
    const id = await host.createGame({ name: "Party", options: { ...RECOMMENDED_OPTIONS, rosterMode: "host" } });
    openApp(host, `/games/${id}/settings`);

    await user.click(within(await panel()).getByRole("button", { name: /use the holiday party photo/i }));

    expect(await within(await panel()).findByRole("img", { name: /this game's own background/i })).toBeInTheDocument();
    await waitFor(() => expect(cssVar("--page-image")).toMatch(new RegExp(`url\\("/api/games/${id}/theme/background\\?v=[^"]+"\\)`)));
  });

  it("is offered for an Organization's background too", async () => {
    partyPhotoServed();
    const { host, lodge, user } = await organizer();
    openApp(host, `/orgs/${lodge}`);

    await user.click(await screen.findByRole("button", { name: /use the holiday party photo/i }));

    expect(await screen.findByRole("img", { name: /lodge 22 background/i })).toBeInTheDocument();
    expect((await host.myOrgs()).find((o) => o.id === lodge)).toMatchObject({ backgroundUrl: expect.stringMatching(/background/) });
  });

  it("leaves the background as it was if the photo doesn't load, and says so", async () => {
    partyPhotoServed(false);
    const { host, user } = await organizer();
    const id = await host.createGame({ name: "Party", options: { ...RECOMMENDED_OPTIONS, rosterMode: "host" } });
    await host.setGameImage(id, "background", new File([tinyPng], "bg.png", { type: "image/png" }));
    openApp(host, `/games/${id}/settings`);
    const look = await panel();
    const before = (await within(look).findByRole("img", { name: /this game's own background/i })).getAttribute("src");

    await user.click(within(look).getByRole("button", { name: /use the holiday party photo/i }));

    expect(await within(look).findByRole("alert")).toHaveTextContent(/didn't load/i);
    expect(within(look).getByRole("img", { name: /this game's own background/i })).toHaveAttribute("src", before!);
  });
});
