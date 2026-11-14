import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

async function setup(rosterMode: "host" | "self") {
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer, baseUrl: "http://app.test" });
  const host = await signIn(app, sent, "host@example.com");
  const res = await app.request("/api/games", post({ name: "Swap", rosterMode, settings: { activeSlots: 1, maxSteals: 3 } }, host));
  const { id } = (await res.json()) as { id: string };
  return { app, sent, host, id };
}

describe("Joining as a Player", () => {
  it("needs a signed-in person", async () => {
    const { app, id } = await setup("self");
    expect((await app.request(`/api/games/${id}/join`, post({ name: "Dan" }))).status).toBe(401);
  });

  it("is refused when the Host enters the Players", async () => {
    const { app, sent, id } = await setup("host");
    const dan = await signIn(app, sent, "dan@example.com");
    expect((await app.request(`/api/games/${id}/join`, post({ name: "Dan" }, dan))).status).toBe(403);
  });

  it("links one person to one Player: a second join is refused", async () => {
    const { app, sent, id } = await setup("self");
    const dan = await signIn(app, sent, "dan@example.com");
    expect((await app.request(`/api/games/${id}/join`, post({ name: "Dan" }, dan))).status).toBe(200);
    expect((await app.request(`/api/games/${id}/join`, post({ name: "Danny" }, dan))).status).toBe(409);

    const game = (await (await app.request(`/api/games/${id}`, { headers: { cookie: dan } })).json()) as {
      players: { id: string; name: string }[];
      me: { playerId: string } | null;
    };
    expect(game.players.map((p) => p.name)).toEqual(["Dan"]);
    expect(game.me?.playerId).toBe(game.players[0]!.id);
  });

  it("is refused once the Game is over", async () => {
    const { app, sent, host, id } = await setup("self");
    await app.request(`/api/games/${id}/commands`, post({ type: "EndGame" }, host));
    const dan = await signIn(app, sent, "dan@example.com");
    expect((await app.request(`/api/games/${id}/join`, post({ name: "Dan" }, dan))).status).toBe(409);
  });

  it("tells nobody else who a Player is", async () => {
    const { app, sent, id } = await setup("self");
    const dan = await signIn(app, sent, "dan@example.com");
    await app.request(`/api/games/${id}/join`, post({ name: "Dan" }, dan));
    const eve = await signIn(app, sent, "eve@example.com");

    const asEve = (await (await app.request(`/api/games/${id}`, { headers: { cookie: eve } })).json()) as Record<string, unknown>;
    expect(asEve["me"]).toBeNull();
    expect(JSON.stringify(asEve)).not.toContain("dan@example.com");
  });
});

describe("The page a sign-in link returns to", () => {
  async function linkAfterAsking(next: unknown) {
    const { sent, mailer } = capturingMailer();
    const { app } = createServer({ dbPath: ":memory:", mailer, baseUrl: "http://app.test" });
    const res = await app.request("/api/auth/link", post({ email: "eve@example.com", next }));
    return { status: res.status, url: sent.at(-1)?.url };
  }

  it("is carried in the emailed link when it's a page of this app", async () => {
    const { url } = await linkAfterAsking("/games/abc123");
    expect(new URL(url!).searchParams.get("next")).toBe("/games/abc123");
  });

  it("can't send people to another site", async () => {
    for (const next of ["//evil.example", "https://evil.example/", "/\\evil.example", "games/abc"]) {
      expect((await linkAfterAsking(next)).status).toBe(400);
    }
  });
});
