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
    const id = await ann.createGame({ activeSlots: 1, maxSteals: 3 }, "Office party");
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
