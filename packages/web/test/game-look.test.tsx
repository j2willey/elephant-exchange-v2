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
 * The app's ready-made look images, as the browser would fetch them from the build; anything else goes on to the
 * server. `found: false` is an image failing to load (a dropped connection, say).
 */
function looksServed(found = true) {
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const asset = /\/src\/(assets\/[^?]+\.webp)/.exec(String(input))?.[1];
    if (!asset) return real(input, init);
    return Promise.resolve(
      found
        ? new Response(readFileSync(join(import.meta.dirname, "../src", asset)), { headers: { "content-type": "image/webp" } })
        : new Response("gone", { status: 404 }),
    );
  });
}
afterEach(() => vi.unstubAllGlobals());

const looks = async () => within(await screen.findByRole("region", { name: /ready-made looks/i }));

describe("Ready-made looks", () => {
  it("set the Game's background and both colors in one tap, and show which one is in use", async () => {
    looksServed();
    const { host, user } = await organizer();
    const id = await host.createGame({ name: "Party", options: { ...RECOMMENDED_OPTIONS, rosterMode: "host" } });
    openApp(host, `/games/${id}/settings`);

    await user.click((await looks()).getByRole("button", { name: /fireside/i }));

    expect(await within(await panel()).findByRole("img", { name: /this game's own background/i })).toBeInTheDocument();
    await waitFor(() => expect(cssVar("--page-image")).toMatch(new RegExp(`url\\("/api/games/${id}/theme/background\\?v=[^"]+"\\)`)));
    await waitFor(() => expect(cssVar("--brand")).toBe("#a3262a"));
    expect(cssVar("--page")).toBe("#2b1a0f");
    // Headings right on the photo sit on a pane of that page color, so they stay readable on a busy picture.
    expect(cssVar("--on-image")).toContain("#2b1a0f");
    expect((await looks()).getByRole("button", { name: /fireside/i })).toHaveAttribute("aria-pressed", "true");
    expect((await looks()).getByRole("button", { name: /golden gala/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("include the office party photo the app has always offered", async () => {
    looksServed();
    const { host, user } = await organizer();
    const id = await host.createGame({ name: "Party", options: { ...RECOMMENDED_OPTIONS, rosterMode: "host" } });
    openApp(host, `/games/${id}/settings`);

    await user.click((await looks()).getByRole("button", { name: /office party/i }));

    expect(await within(await panel()).findByRole("img", { name: /this game's own background/i })).toBeInTheDocument();
  });

  it("are offered for an Organization's Theme too", async () => {
    looksServed();
    const { host, lodge, user } = await organizer();
    openApp(host, `/orgs/${lodge}`);

    await user.click((await looks()).getByRole("button", { name: /golden gala/i }));

    expect(await screen.findByRole("img", { name: /lodge 22 background/i })).toBeInTheDocument();
    await waitFor(async () =>
      expect((await host.myOrgs()).find((o) => o.id === lodge)).toMatchObject({ color: "#b8913a", page: "#1c1813", backgroundUrl: expect.stringMatching(/background/) }),
    );
    expect((await looks()).getByRole("button", { name: /golden gala/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("leave the background and colors as they were if the image doesn't load, and say so", async () => {
    looksServed(false);
    const { host, user } = await organizer();
    const id = await host.createGame({ name: "Party", options: { ...RECOMMENDED_OPTIONS, rosterMode: "host" } });
    await host.setGameImage(id, "background", new File([tinyPng], "bg.png", { type: "image/png" }));
    openApp(host, `/games/${id}/settings`);
    const before = (await within(await panel()).findByRole("img", { name: /this game's own background/i })).getAttribute("src");

    await user.click((await looks()).getByRole("button", { name: /fireside/i }));

    expect(await (await looks()).findByRole("alert")).toHaveTextContent(/didn't work/i);
    expect(within(await panel()).getByRole("img", { name: /this game's own background/i })).toHaveAttribute("src", before!);
    expect(cssVar("--brand")).not.toBe("#a3262a");
  });
});
