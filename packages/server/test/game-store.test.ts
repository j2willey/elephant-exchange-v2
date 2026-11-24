import { describe, expect, it } from "vitest";
import { games, openDb, organizations } from "../src/db.js";
import { createGameStore, type GamePatch, type LoadedGame, type OrgTheme } from "../src/game-store.js";

/** A store on a fresh database holding one Game, "g", and one Organization, "lodge"; every announcement recorded. */
function setup() {
  const db = openDb(":memory:");
  db.insert(games).values({ id: "g", settings: JSON.stringify({ activeSlots: 1, maxSteals: 3 }), createdAt: new Date() }).run();
  db.insert(organizations).values({ id: "lodge", name: "Lodge 22", organizerEmail: "org@x", createdAt: new Date(), color: "#112233" }).run();
  const orgTheme = (orgId: string): OrgTheme | null => {
    const o = db.select().from(organizations).all().find((r) => r.id === orgId);
    return o ? { id: o.id, name: o.name, color: o.color, page: o.page, logo: o.logo, background: o.background } : null;
  };
  let clock = 1_000_000;
  const store = createGameStore({ db, now: () => new Date(clock), draw: (c) => c[0]!, orgTheme });
  const heard: { id: string; game: LoadedGame }[] = [];
  store.onChange((id, game) => heard.push({ id, game }));
  return { db, store, heard, tick: (ms: number) => (clock += ms) };
}

/** Everything about a Game that's kept beside its log, as it would be rebuilt from the database. */
const settingsOf = (g: LoadedGame) => ({ ...g, state: undefined, clocks: [...g.clocks], vote: { ...g.vote, ballots: [...g.vote.ballots] } });

describe("The Game store", () => {
  const patches: [string, GamePatch][] = [
    ["name", { name: "OA Holiday Party" }],
    ["tagline", { tagline: "It's going to be a gas!" }],
    ["When & where", { whenWhere: "Fri Dec 12, 10 am · Room B" }],
    ["who adds Players", { rosterMode: "self" }],
    ["Moderation", { moderation: "approval" }],
    ["Approve names", { approveNames: true }],
    ["turn timer", { turnSeconds: 90 }],
    ["Feed limits", { postsPerMinute: 5, repitchMinutes: 0 }],
    ["big screen", { screen: "catalog" }],
    ["vote", { vote: { status: "closed", display: "parade", winner: "g1" } }],
    ["own Theme", { own: { color: "#ff0000", page: "#ffffff", logo: "v1", background: "v2" } }],
    ["an Organization's Theme", { orgId: "lodge" }],
  ];

  it.each(patches)("keeps a change to the %s in the database and in memory alike", (_label, patch) => {
    const { store } = setup();
    const changed = store.change("g", () => patch)!;

    store.forget("g");
    const rebuilt = store.get("g")!;

    expect(settingsOf(rebuilt)).toEqual(settingsOf(changed));
    expect(settingsOf(changed)).not.toEqual(settingsOf(setup().store.get("g")!));
  });

  it("hands a change the latest copy, and announces each change once", () => {
    const { store, heard } = setup();
    store.change("g", () => ({ tagline: "one" }));
    const seen: string[] = [];
    store.change("g", (g) => (seen.push(g.tagline), { name: "two" }));

    expect(seen).toEqual(["one"]);
    expect(heard.map((h) => [h.game.tagline, h.game.name])).toEqual([
      ["one", "Gift exchange"],
      ["one", "two"],
    ]);
  });

  it("writes and announces nothing when a change decides on none", () => {
    const { store, heard } = setup();
    expect(store.change("g", () => null)?.tagline).toBe("");
    expect(heard).toEqual([]);
  });

  it("logs a command and announces the Game; a refused one is neither", () => {
    const { store, heard } = setup();
    const after = store.command("g", { type: "AddPlayer", playerId: "ann", name: "Ann" });
    expect(after).toMatchObject({ seq: 1 });
    expect(store.command("g", { type: "Undo" })).toMatchObject({ code: "NothingToUndo" });
    expect(heard).toHaveLength(1);

    store.forget("g");
    expect(store.get("g")!.state.players).toEqual([{ id: "ann", name: "Ann" }]);
  });

  it("answers undefined for a Game that doesn't exist", () => {
    const { store } = setup();
    expect(store.get("nope")).toBeUndefined();
    expect(store.command("nope", { type: "StartGame" })).toBeUndefined();
    expect(store.change("nope", () => ({ name: "x" }))).toBeUndefined();
  });

  it("keeps ballots and restarted clocks across a rebuild", () => {
    const { store, tick } = setup();
    store.command("g", { type: "AddPlayer", playerId: "ann", name: "Ann" });
    store.command("g", { type: "StartGame" });
    tick(5000);
    const reset = store.resetClock("g", "ann")!;
    store.castBallot("g", "gus@x", "g1");
    expect(store.resetClock("g", "nobody")).toBeUndefined();

    store.forget("g");
    const rebuilt = store.get("g")!;
    expect(rebuilt.clocks.get("ann")).toBe(reset.clocks.get("ann"));
    expect(rebuilt.vote.ballots.get("gus@x")).toBe("g1");
  });

  it("brings Games showing an Organization up to date when it changes or goes", () => {
    const { db, store, heard } = setup();
    store.change("g", () => ({ orgId: "lodge" }));
    db.update(organizations).set({ color: "#445566" }).run();
    store.orgChanged("lodge");
    expect(store.get("g")!.theme.org?.color).toBe("#445566");

    db.update(games).set({ orgId: null }).run(); // as deleting an Organization does
    db.delete(organizations).run();
    store.orgChanged("lodge");
    expect(store.get("g")!.theme.org).toBeNull();
    expect(heard).toHaveLength(3);
  });

  it("lets go of Games nobody has asked for lately, unless a screen watches them", () => {
    const { db, store, tick } = setup();
    db.insert(games).values({ id: "h", settings: JSON.stringify({ activeSlots: 1, maxSteals: 3 }), createdAt: new Date() }).run();
    store.get("g");
    store.get("h");
    tick(10_000);
    const before = 1_000_000 + 5_000;

    expect(store.forgetIdle(before, (id) => id === "h", ["feed-only"])).toEqual(["g", "feed-only"]);
    expect(store.size()).toBe(1);
  });
});
