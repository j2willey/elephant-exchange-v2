import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createAccess, DEMO_ACTOR, DEMO_PLAYER_HEADER, type Need } from "../src/access.js";
import { gameHosts, gamePlayers, games, openDb } from "../src/db.js";
import { createPeople } from "../src/people.js";

type FakeGame = { demo: boolean; roster: string[] };

/**
 * Two Games, "real" and "demo", each with a Host, a Co-host, a Player who signed up ("pam") and a typed-in Player
 * ("tia"). Sessions are the cookie value itself: `session=host@x` is host@x; `session=vic@visitors.invalid` a visitor.
 * The app has one route per Need, answering with what Game access worked out.
 */
function setup() {
  const db = openDb(":memory:");
  const fakeGames: Record<string, FakeGame> = {
    real: { demo: false, roster: ["pam", "tia"] },
    demo: { demo: true, roster: ["pam", "tia"] },
  };
  for (const [id, g] of Object.entries(fakeGames)) {
    db.insert(games).values({ id, settings: "{}", createdAt: new Date(), demo: g.demo }).run();
    db.insert(gameHosts).values([{ gameId: id, email: "host@x", role: "host" }, { gameId: id, email: "co@x", role: "cohost" }]).run();
    db.insert(gamePlayers).values({ gameId: id, playerId: "pam", email: "pam@x" }).run();
  }
  const people = createPeople<FakeGame>({
    db,
    rosterOf: (game) => game.roster.map((id) => ({ id, name: id })),
    latest: (id) => fakeGames[id]!,
    approveNames: () => false,
    command: () => undefined,
    renameAuthor: () => undefined,
    postsChanged: () => undefined,
    staffChanged: () => undefined,
  });
  const access = createAccess<FakeGame>({
    sessionEmail: (token) => token,
    load: (id) => fakeGames[id],
    onRoster: (game, playerId) => game.roster.includes(playerId),
    people,
  });
  const app = new Hono();
  app.use("/games/:id/*", access.identify);
  for (const need of ["anyone", "signedIn", "staff", "host"] as const) {
    app.post(`/games/:id/${need}`, access.need(need), (c) => {
      const { id, email, role, playerId } = c.var.access;
      return c.json({ id, email: email ?? null, role: role ?? null, playerId: playerId ?? null });
    });
  }
  app.post("/games/:id/vote", access.need("signedIn", "Sign in to vote"), (c) => c.body(null, 204));
  app.post("/games/:id/screen", access.need("staff", "Only the Host and Co-hosts can switch the big screen"), (c) => c.body(null, 204));
  const ask = (game: string, need: Need | "vote" | "screen", who?: string, demoPlayer?: string) =>
    app.request(`/games/${game}/${need}`, {
      method: "POST",
      headers: { ...(who ? { cookie: `session=${who}` } : {}), ...(demoPlayer ? { [DEMO_PLAYER_HEADER]: demoPlayer } : {}) },
    });
  return { access, ask, db, people };
}

const VISITOR = "vic@visitors.invalid";

describe("Game access", () => {
  // [who asks, Game, header, then the status for anyone / signedIn / staff / host]
  const matrix: [string, string | undefined, string, string | undefined, number, number, number, number][] = [
    ["signed out", undefined, "real", undefined, 200, 401, 401, 401],
    ["a Guest", "gus@x", "real", undefined, 200, 200, 403, 403],
    ["a Player", "pam@x", "real", undefined, 200, 200, 403, 403],
    ["a Co-host", "co@x", "real", undefined, 200, 200, 200, 403],
    ["the Host", "host@x", "real", undefined, 200, 200, 200, 200],
    ["a demo visitor, in a real Game", VISITOR, "real", undefined, 200, 401, 401, 401],
    ["a demo visitor, in a demo Game", VISITOR, "demo", undefined, 200, 200, 403, 403],
    ["the Host's sample phone, as a typed-in Player", "host@x", "demo", "tia", 200, 200, 403, 403],
  ];

  it.each(matrix)("%s (%s in the %s Game, header %s)", async (_label, who, game, header, ...expected) => {
    const { ask } = setup();
    const got = [];
    for (const need of ["anyone", "signedIn", "staff", "host"] as const) got.push((await ask(game, need, who, header)).status);
    expect(got).toEqual(expected);
  });

  it("refuses for a Game that doesn't exist, after the sign-in check", async () => {
    const { ask } = setup();
    expect((await ask("nope", "staff")).status).toBe(401);
    expect((await ask("nope", "staff", "host@x")).status).toBe(404);
    expect(await (await ask("nope", "anyone")).json()).toEqual({ error: "Game not found" });
  });

  it("tells a route who is asking, their role and which Player they are", async () => {
    const { ask } = setup();
    expect(await (await ask("real", "signedIn", "pam@x")).json()).toEqual({ id: "real", email: "pam@x", role: null, playerId: "pam" });
    expect(await (await ask("real", "staff", "co@x")).json()).toEqual({ id: "real", email: "co@x", role: "cohost", playerId: null });
    expect(await (await ask("real", "anyone")).json()).toEqual({ id: "real", email: null, role: null, playerId: null });
  });

  it("uses a route's own wording when it has one, and the standard wording otherwise", async () => {
    const { ask } = setup();
    expect(await (await ask("real", "vote")).json()).toEqual({ error: "Sign in to vote" });
    expect(await (await ask("real", "screen", "gus@x")).json()).toEqual({ error: "Only the Host and Co-hosts can switch the big screen" });
    expect(await (await ask("real", "staff", "gus@x")).json()).toEqual({ error: "Only the Host and Co-hosts can do that" });
    expect(await (await ask("real", "host", "co@x")).json()).toEqual({ error: "Only the Host can do that" });
    expect(await (await ask("real", "signedIn")).json()).toEqual({ error: "Sign in first" });
  });

  describe("the demo page's sample phone (ADR 0004)", () => {
    it("acts as a Player who has a stand-in email by that email, and as one without by the stand-in identity", async () => {
      const { ask } = setup();
      expect(await (await ask("demo", "signedIn", "host@x", "pam")).json()).toMatchObject({ email: "pam@x", playerId: "pam", role: null });
      expect(await (await ask("demo", "signedIn", "host@x", "tia")).json()).toMatchObject({ email: `${DEMO_ACTOR}tia`, playerId: "tia" });
    });

    it("acts as a Co-host if the Host made that Player one, never as the Host", async () => {
      const { ask, people } = setup();
      people.addCohost("demo", "pam@x", undefined);
      expect(await (await ask("demo", "staff", "co@x", "pam")).json()).toMatchObject({ email: "pam@x", role: "cohost" });
      expect((await ask("demo", "host", "host@x", "pam")).status).toBe(403);
    });

    it("is refused in a real Game, from someone not on the Staff, for a Player not on the Roster, or signed out", async () => {
      const { ask } = setup();
      const refusals = [
        await ask("real", "anyone", "host@x", "pam"),
        await ask("demo", "anyone", "gus@x", "pam"),
        await ask("demo", "anyone", "host@x", "zed"),
        await ask("demo", "anyone", undefined, "pam"),
      ];
      expect(refusals.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    });
  });

  it("works out who is asking on any route, the same way", async () => {
    const { access } = setup();
    const app = new Hono();
    app.get("/whoami", (c) => c.json({ email: access.emailOf(c) ?? null }));
    const res = await app.request("/whoami", { headers: { cookie: "session=ann@x" } });
    expect(await res.json()).toEqual({ email: "ann@x" });
  });
});
