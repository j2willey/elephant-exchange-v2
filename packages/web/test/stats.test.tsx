import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { browser, drawInOrder, openApp, startServer } from "./harness.js";

describe("Where people came from", () => {
  it("is noted when someone arrives from a ?ref= link, and credited when they sign in", async () => {
    const server = await startServer({ adminEmails: ["boss@example.org"] });
    const visitor = browser(server.origin);
    openApp(visitor, "/?ref=LinkedIn");
    await screen.findByRole("region", { name: /what it is/i });

    // Signing in later, on the same browser, from the landing page's form.
    await visitor.requestLink("ann@example.org");
    const token = new URLSearchParams(server.linkFor("ann@example.org").split("?")[1]).get("token")!;
    await visitor.redeemLink(token);

    const admin = await server.signedIn("boss@example.org");
    await waitFor(async () => {
      const stats = await admin.adminStats();
      expect(stats !== "notFound" && stats.sources).toEqual([{ ref: "linkedin", visits: 1, signUps: 1 }]);
    });
  });
});

describe("The admin's Stats page", () => {
  it("shows the totals and the Games, and leaves out a Game the admin excludes", async () => {
    const server = await startServer({ draw: drawInOrder, adminEmails: ["boss@example.org"] });
    const ann = await server.signedIn("ann@example.org");
    const id = await ann.createGame({ name: "Office party", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    for (const p of ["a", "b", "c", "d"]) await ann.command(id, { type: "AddPlayer", playerId: p, name: p.toUpperCase() });
    await ann.command(id, { type: "StartGame" });
    for (const [p, g] of [["a", "g1"], ["b", "g2"], ["c", "g3"], ["d", "g4"]] as const) await ann.command(id, { type: "OpenGift", playerId: p, giftId: g, name: g });
    await ann.command(id, { type: "EndGame" });
    const admin = await server.signedIn("boss@example.org");
    const user = userEvent.setup();
    openApp(admin, "/admin/stats");

    const totals = await screen.findByRole("region", { name: /totals/i });
    const figure = (label: RegExp) => within(totals).getByText(label).closest("div")!;
    expect(figure(/^games played$/i)).toHaveTextContent("1");
    expect(figure(/^hosts$/i)).toHaveTextContent("1");
    // Phase 2: the funnel, and how the Game played.
    const funnel = screen.getByRole("list", { name: /funnel/i });
    expect(within(funnel).getByRole("listitem", { name: /^started one: 1/i })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: /parties and play/i })).getByText(/players per game/i).closest("div")).toHaveTextContent("4");
    expect(screen.getByRole("list", { name: /played games per week/i })).toBeInTheDocument();

    const row = within(screen.getByRole("table", { name: /games in the statistics/i })).getByRole("row", { name: "Office party" });
    expect(row).toHaveTextContent(/ann@example.org.*yes/i);

    await user.click(within(row).getByRole("checkbox", { name: /exclude office party/i }));

    await waitFor(() => expect(figure(/^games played$/i)).toHaveTextContent("0"));
  });

  it("isn't there for anyone else", async () => {
    const server = await startServer({ adminEmails: ["boss@example.org"] });
    openApp(await server.signedIn("ann@example.org"), "/admin/stats");
    expect(await screen.findByText(/there's nothing here/i)).toBeInTheDocument();
  });
});

describe("Features only the browser sees", () => {
  it("counts a roster pasted on the Host's console", async () => {
    const server = await startServer({ draw: drawInOrder, adminEmails: ["boss@example.org"] });
    const ann = await server.signedIn("ann@example.org");
    const id = await ann.createGame({ name: "Pasted party", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    const user = userEvent.setup();
    openApp(ann, `/games/${id}`);

    await user.click(await screen.findByRole("button", { name: /paste a list/i }));
    await user.click(screen.getByLabelText(/names, one per line/i));
    await user.paste("Ann\nBob\nCat\nDan");
    await user.click(screen.getByRole("button", { name: /add 4 players/i }));
    await screen.findByRole("status");

    // Played out, so it counts.
    const ids = (await ann.game(id))!.players.map((p) => p.id);
    await ann.command(id, { type: "StartGame" });
    for (const [i, p] of ids.entries()) await ann.command(id, { type: "OpenGift", playerId: p, giftId: `g${i}`, name: `Gift ${i}` });
    const admin = await server.signedIn("boss@example.org");
    await waitFor(async () => {
      const stats = await admin.adminStats();
      expect(stats !== "notFound" && stats.insights.features.find((f) => f.feature === "rosterPaste")).toEqual({ feature: "rosterPaste", games: 1 });
    });
  });
});

describe("How Games are set up, on the Stats page", () => {
  it("shows how settings were chosen, what each was set to, and the timer against real Turns", async () => {
    const server = await startServer({ draw: drawInOrder, adminEmails: ["boss@example.org"] });
    const ann = await server.signedIn("ann@example.org");
    await ann.createGame({ name: "Quick one", options: { ...RECOMMENDED_OPTIONS }, start: "recommended" });
    const id = await ann.createGame({ name: "Big party", options: { ...RECOMMENDED_OPTIONS, activeSlots: 3, turnSeconds: 90 }, start: "customized", looked: true });
    for (const p of ["a", "b", "c", "d"]) await ann.command(id, { type: "AddPlayer", playerId: p, name: p.toUpperCase() });
    await ann.command(id, { type: "StartGame" });
    for (const [p, g] of [["a", "g1"], ["b", "g2"], ["c", "g3"], ["d", "g4"]] as const) await ann.command(id, { type: "OpenGift", playerId: p, giftId: g, name: g });
    openApp(await server.signedIn("boss@example.org"), "/admin/stats");

    const section = await screen.findByRole("region", { name: /how games are set up/i });
    const chosen = within(section).getByRole("list", { name: /settings chosen/i });
    expect(within(chosen).getByRole("listitem", { name: /^recommended settings: 1, 0 looked/i })).toBeInTheDocument();
    expect(within(chosen).getByRole("listitem", { name: /^customized: 1, 1 looked/i })).toBeInTheDocument();
    const slots = within(within(section).getByRole("table", { name: /settings used/i })).getByRole("row", { name: /players at once/i });
    expect(slots).toHaveTextContent(/1 \(rec\.\): 1.*3: 1/);
    const timer = within(within(section).getByRole("table", { name: /turn timer/i })).getAllByRole("row");
    expect(timer[1]).toHaveTextContent(/^90 s1/);
  });
});

describe("Records, on the Stats page", () => {
  it("name the biggest played Game with its length", async () => {
    const server = await startServer({ draw: drawInOrder, adminEmails: ["boss@example.org"] });
    const ann = await server.signedIn("ann@example.org");
    const id = await ann.createGame({ name: "Office party", options: { ...RECOMMENDED_OPTIONS } });
    for (const p of ["a", "b", "c", "d", "e"]) await ann.command(id, { type: "AddPlayer", playerId: p, name: p.toUpperCase() });
    await ann.command(id, { type: "StartGame" });
    for (const [p, g] of [["a", "g1"], ["b", "g2"], ["c", "g3"], ["d", "g4"], ["e", "g5"]] as const) await ann.command(id, { type: "OpenGift", playerId: p, giftId: g, name: g });
    await ann.command(id, { type: "EndGame" });
    openApp(await server.signedIn("boss@example.org"), "/admin/stats");

    const most = await screen.findByRole("list", { name: /most players/i });
    expect(within(most).getAllByRole("listitem")[0]).toHaveTextContent(/5 players · office party.*min/i);
  });
});
