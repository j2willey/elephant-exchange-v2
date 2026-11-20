import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawInOrder, openApp, startServer } from "./harness.js";

/** Laptop or phone: the test browser has no screen size of its own. */
function screenWidth(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: wide && query.includes("min-width"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}
beforeEach(() => screenWidth(true));
afterEach(() => vi.unstubAllGlobals());

/** A Self sign-up Game: Tess joined as a Player, Gus posted as a Guest, and the Host typed in Pat. */
async function party() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ name: "Acme Holiday Party", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3, rosterMode: "self" } });
  const tess = await server.signedIn("tess@example.com");
  await tess.join(id, "Tess");
  const gus = await server.signedIn("gus@example.com");
  await gus.post(id, { text: "Hi all", name: "Gus" });
  await host.command(id, { type: "AddPlayer", playerId: "pat", name: "Pat" });
  return { ...server, host, tess, gus, id, user: userEvent.setup() };
}

const panel = () => screen.findByRole("region", { name: /^co-hosts$/i });
const person = async (name: RegExp) => within(await panel()).findByRole("listitem", { name });
const participant = async (name: string) =>
  within(await screen.findByRole("region", { name: /participants/i })).findByRole("listitem", { name: new RegExp(`^${name}\\b`) });

describe("The Co-hosts panel", () => {
  it("is opened from the Host's console, finds people as the Host types, and switches a Co-host on and off", async () => {
    const { host, id, user } = await party();
    openApp(host, `/games/${id}`);

    await user.click(await screen.findByRole("link", { name: /co-hosts/i }));
    const list = await panel();
    await waitFor(() => expect(within(list).getAllByRole("listitem").length).toBeGreaterThanOrEqual(3));

    await user.type(within(list).getByLabelText(/find someone/i), "te");
    await waitFor(() => expect(within(list).getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual(["Tess"]));

    const tess = await person(/^tess$/i);
    await user.click(within(tess).getByRole("switch", { name: /co-host/i }));
    await waitFor(async () => expect(await host.staff(id)).toEqual([{ playerId: expect.any(String), role: "cohost" }]));
    await waitFor(async () => expect(within(await person(/^tess$/i)).getByRole("switch", { name: /co-host/i })).toBeChecked());

    await user.click(within(await person(/^tess$/i)).getByRole("switch", { name: /co-host/i }));
    await waitFor(async () => expect(await host.staff(id)).toEqual([]));
  });

  it("names the Host, who can't be switched off, and says which Player they play as", async () => {
    const { host, id, user } = await party();
    openApp(host, `/games/${id}/cohosts`);

    const me = await person(/^you/i);
    expect(within(me).queryByRole("switch")).not.toBeInTheDocument();
    await user.selectOptions(within(me).getByLabelText(/plays as/i), "Pat");
    await waitFor(async () => expect(await host.staff(id)).toEqual([{ playerId: "pat", role: "host" }]));
  });

  it("still adds someone by email who hasn't joined yet", async () => {
    const { host, id, user, signedIn } = await party();
    openApp(host, `/games/${id}/cohosts`);

    await user.type(within(await panel()).getByLabelText(/add a co-host by email/i), "zed@example.com");
    await user.click(within(await panel()).getByRole("button", { name: /^add$/i }));

    const zed = await signedIn("zed@example.com");
    await waitFor(async () => expect(await zed.staff(id)).toEqual([]));
  });

  it("finds a Player the Host typed in, and makes them a Co-host once given an email", async () => {
    const { host, id, user } = await party();
    openApp(host, `/games/${id}/cohosts`);

    await user.type(within(await panel()).getByLabelText(/find someone/i), "pa");
    const pat = await within(await panel()).findByRole("listitem", { name: /^pat\b/i });
    expect(pat).toHaveTextContent(/typed in/i);
    expect(await panel()).not.toHaveTextContent(/nobody by that name/i);

    await user.type(within(pat).getByLabelText(/pat's email/i), "pat@example.com");
    await user.click(within(pat).getByRole("button", { name: /make co-host/i }));

    await waitFor(async () => expect(await host.staff(id)).toEqual([{ playerId: "pat", role: "cohost" }]));
    await waitFor(async () => expect(within(await person(/^pat$/i)).getByRole("switch", { name: /co-host/i })).toBeChecked());
  });

  it("isn't offered to a Co-host", async () => {
    const { host, tess, id } = await party();
    await host.addCohost(id, "tess@example.com");
    openApp(tess, `/games/${id}`);

    await screen.findByRole("region", { name: /participants/i });
    expect(screen.queryByRole("link", { name: /co-hosts/i })).not.toBeInTheDocument();
  });
});

describe("Marking the Host and Co-hosts among the Participants", () => {
  it("shows the Host and every Co-host beside their names, on the Host's and Co-hosts' screens", async () => {
    const { host, tess, id } = await party();
    await host.addCohost(id, "tess@example.com");
    const people = await host.people(id);
    await host.setPerson(id, people.find((p) => p.you)!.key, { playsAs: "pat" });

    openApp(tess, `/games/${id}`);

    await waitFor(async () => expect(await participant("Tess")).toHaveTextContent(/co-host/i));
    expect(await participant("Pat")).toHaveTextContent(/host/i);
  });

  it("keeps up as the Host changes who co-hosts", async () => {
    const { host, id } = await party();
    openApp(host, `/games/${id}`);
    await participant("Tess");

    await host.addCohost(id, "tess@example.com");

    await waitFor(async () => expect(await participant("Tess")).toHaveTextContent(/co-host/i));
  });

  it("shows them on the phone console too", async () => {
    screenWidth(false);
    const { host, id } = await party();
    await host.addCohost(id, "tess@example.com");
    openApp(host, `/games/${id}`);

    const players = await screen.findByRole("list", { name: /^players$/i });
    await waitFor(() => expect(within(players).getByText("Tess").closest("li")).toHaveTextContent(/co-host/i));
  });

  it("isn't shown to guests", async () => {
    const { host, gus, id } = await party();
    await host.addCohost(id, "tess@example.com");
    expect(await gus.staff(id).catch(() => "refused")).toBe("refused");
  });
});
