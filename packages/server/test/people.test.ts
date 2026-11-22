import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_ACTOR } from "../src/access.js";
import { gameHosts, games, openDb, posts } from "../src/db.js";
import { createFeed } from "../src/feed.js";
import { createGameStore, type LoadedGame } from "../src/game-store.js";
import { createPeople } from "../src/people.js";
import { photoStore } from "../src/photos.js";
import { roster } from "@elephant/rules";

/**
 * People on a fresh database with one Game, "g", hosted by host@x, with Ann, Bob and the Host's own Player Hal on
 * its Roster. Signals are recorded; `fresh()` is People on the same database read afresh, as after a restart.
 */
function setup() {
  const db = openDb(":memory:");
  const now = () => new Date();
  const store = createGameStore({ db, now, draw: (c) => c[0]!, orgTheme: () => null });
  const feed = createFeed({ db, now, store, photos: photoStore(mkdtempSync(join(tmpdir(), "people-test-"))), signal: () => undefined, signalMs: 0 });
  const signals: string[] = [];
  const make = () =>
    createPeople<LoadedGame>({
      db,
      rosterOf: (game) => roster(game.state),
      latest: (id) => store.get(id)!,
      approveNames: (game) => game.approveNames,
      command: (id, cmd, alsoWrite) => store.command(id, cmd, alsoWrite),
      renameAuthor: feed.renameAuthor,
      postsChanged: (id) => (feed.changed(id), signals.push("posts")),
      staffChanged: () => void signals.push("staff"),
    });
  const people = make();
  db.transaction((tx) => {
    tx.insert(games).values({ id: "g", settings: JSON.stringify({ activeSlots: 1, maxSteals: 3 }), createdAt: new Date() }).run();
    people.addHost(tx, "g", "host@x");
  });
  for (const [id, name] of [["ann", "Ann"], ["bob", "Bob"], ["hal", "Hal"]]) store.command("g", { type: "AddPlayer", playerId: id!, name: name! });
  const game = () => store.get("g")!;
  const joinAs = (playerId: string, email: string) => db.transaction((tx) => people.linkPlayer(tx, "g", playerId, email));
  return { db, store, feed, people, signals, game, joinAs, fresh: make };
}

describe("People in a Game", () => {
  it("knows the Host, and lets them play as a Player with a turn like anyone's", () => {
    const { people, game, fresh, store } = setup();
    people.setStaff("g", "host@x", { playsAs: "hal" });

    expect(people.roleIn("g", "host@x")).toBe("host");
    expect(people.staffOf("g", game())).toEqual([{ email: "host@x", playerId: "hal", role: "host" }]);
    expect(fresh().staffOf("g", game())).toEqual(people.staffOf("g", game()));
    store.command("g", { type: "StartGame" });
    expect(game().state.active).toEqual(["ann"]); // the Host's Hal waits for their turn like Ann and Bob
  });

  it("makes someone a Co-host and takes it away again, but the Host stays the Host", () => {
    const { people, fresh } = setup();
    people.setStaff("g", "co@x", { cohost: true });
    expect(people.roleIn("g", "co@x")).toBe("cohost");

    people.setStaff("g", "host@x", { cohost: false });
    people.removeCohost("g", "host@x");
    expect(people.roleIn("g", "host@x")).toBe("host");

    people.removeCohost("g", "co@x");
    expect(people.roleIn("g", "co@x")).toBeUndefined();
    expect(fresh().roleIn("g", "co@x")).toBeUndefined();
  });

  it("appoints a Co-host by email who plays as a Player, and marks them with the Player", () => {
    const { people, game, fresh } = setup();
    people.addCohost("g", "pat@x", "bob");
    expect(people.staffOf("g", game())).toContainEqual({ email: "pat@x", playerId: "bob", role: "cohost" });
    expect(fresh().roleIn("g", "pat@x")).toBe("cohost");
  });

  it("knows who joined as which Player, only while that Player is on the Roster", () => {
    const { people, game, fresh, joinAs, store } = setup();
    joinAs("ann", "ann@x");
    expect(people.playerOf("g", "ann@x", game())).toBe("ann");
    expect(people.emailOfPlayer("g", "ann")).toBe("ann@x");
    expect(fresh().playerOf("g", "ann@x", game())).toBe("ann");

    store.command("g", { type: "RemovePlayer", playerId: "ann" });
    expect(people.playerOf("g", "ann@x", game())).toBeUndefined();
  });

  it("moves someone who joins again to their new Player", () => {
    const { people, game, joinAs } = setup();
    joinAs("ann", "ann@x");
    joinAs("bob", "ann@x");
    expect(people.playerOf("g", "ann@x", game())).toBe("bob");
    expect(people.emailOfPlayer("g", "ann")).toBeUndefined();
  });

  it("knows a demo stand-in identity as its Player", () => {
    const { people, game } = setup();
    expect(people.playerOf("g", `${DEMO_ACTOR}bob`, game())).toBe("bob");
    expect(people.playerOf("g", `${DEMO_ACTOR}zed`, game())).toBeUndefined();
  });

  it("isn't left believing a write that was rolled back", () => {
    const { db, people, game } = setup();
    people.roleIn("g", "host@x"); // the Game's people are now in memory
    expect(() =>
      db.transaction((tx) => {
        people.linkPlayer(tx, "g", "ann", "ann@x");
        expect(people.playerOf("g", "ann@x", game())).toBe("ann"); // seen inside the transaction
        throw new Error("the Pick was refused");
      }),
    ).toThrow();
    people.changed("g");
    expect(people.playerOf("g", "ann@x", game())).toBeUndefined();
  });

  it("reads a Game's people once, until they change", () => {
    const { db, people } = setup();
    expect(people.roleIn("g", "sly@x")).toBeUndefined();
    db.insert(gameHosts).values({ gameId: "g", email: "sly@x", role: "cohost" }).run(); // behind People's back
    expect(people.roleIn("g", "sly@x")).toBeUndefined(); // still the copy in memory
    people.changed("g");
    expect(people.roleIn("g", "sly@x")).toBe("cohost");
  });

  describe("the Co-hosts panel", () => {
    const keyOf = (people: ReturnType<typeof setup>["people"], game: LoadedGame, email: string) =>
      people.panel("g", game, "host@x").find((p) => p.hint.endsWith(email.slice(email.lastIndexOf("@"))) && p.you === (email === "host@x"))!.key;

    it("lists everyone the Game knows by name, never by email, the Host marked as you", () => {
      const { people, game, joinAs } = setup();
      joinAs("ann", "ann@x");
      const panel = people.panel("g", game(), "host@x");
      expect(panel.map((p) => [p.name, p.role, p.you])).toEqual([
        ["Ann", null, false],
        [null, "host", true],
      ]);
      expect(JSON.stringify(panel)).not.toContain("ann@x");
    });

    it("lets the Host play as a Player, keeps the Host the Host, and lets only the Staff play as someone", () => {
      const { people, game, joinAs } = setup();
      joinAs("ann", "ann@x");
      const host = keyOf(people, game(), "host@x");
      const ann = people.panel("g", game(), "host@x").find((p) => p.name === "Ann")!.key;

      expect(people.appoint("g", host, { playsAs: "hal" })).toBeNull();
      expect(people.staffOf("g", game())).toEqual([{ email: "host@x", playerId: "hal", role: "host" }]);
      expect(people.appoint("g", host, { cohost: false })).toMatchObject({ refused: "Invalid", message: "The Host is always the Host" });
      expect(people.appoint("g", ann, { playsAs: "bob" })).toMatchObject({ refused: "Invalid" });
      expect(people.appoint("g", ann, { playsAs: "zed", cohost: true })).toMatchObject({ refused: "Invalid" });
      expect(people.appoint("g", "nobody", { cohost: true })).toMatchObject({ refused: "NotFound" });
      expect(people.appoint("g", ann, { cohost: true })).toBeNull();
      expect(people.roleIn("g", "ann@x")).toBe("cohost");
    });

    it("approves a waiting name by its key, once", () => {
      const { people, store } = setup();
      store.change("g", () => ({ approveNames: true }));
      people.changeMyName("g", "gus@x", "Gus");
      const [waiting] = people.pending("g", store.get("g")!);
      expect(waiting).toMatchObject({ shown: "Guest", wants: "Gus", playerId: null });

      expect(people.approve("g", waiting!.key)).toBeNull();
      expect(people.approve("g", waiting!.key)).toMatchObject({ refused: "NotFound" });
      expect(people.pending("g", store.get("g")!)).toEqual([]);
    });
  });

  describe("Names", () => {
    it("posts a Player under their Roster name, and a Guest under the name they give, theirs from then on", () => {
      const { people, joinAs } = setup();
      joinAs("ann", "ann@x");
      expect(people.nameToPostAs("g", "ann@x", "Queen Ann")?.author).toBe("Ann");
      expect(people.nameToPostAs("g", "gus@x", undefined)).toBeUndefined();

      const gus = people.nameToPostAs("g", "gus@x", "Gus")!;
      expect(gus.author).toBe("Gus");
      gus.settle();
      expect(people.nameToPostAs("g", "gus@x", undefined)?.author).toBe("Gus");
    });

    it("under Approve names, holds a Guest's new name and posts them as Guest until the Staff approve it", () => {
      const { people, store, signals } = setup();
      store.change("g", () => ({ approveNames: true }));
      const gus = people.nameToPostAs("g", "gus@x", "Gus")!;
      expect(gus.author).toBe("Guest");
      gus.settle();
      expect(people.nameIn("g", "gus@x", store.get("g")!)).toEqual({ name: null, locked: false, pending: "Gus" });
      expect(signals).toContain("staff");

      people.rename("g", { email: "gus@x" }, "Gus");
      expect(people.nameIn("g", "gus@x", store.get("g")!)).toEqual({ name: "Gus", locked: false, pending: null });
      expect(people.needsApproval("g", "host@x", store.get("g")!)).toBe(false); // the Staff's never wait
    });

    it("renames a Player on the Roster and on every Post they made, and a locked name can't be changed back", () => {
      const { db, people, game, joinAs } = setup();
      joinAs("ann", "ann@x");
      db.insert(posts).values({ id: "p1", gameId: "g", email: "ann@x", author: "Ann", text: "Hi", status: "visible", createdAt: new Date() }).run();

      people.rename("g", { playerId: "ann" }, "Annie", true);
      expect(roster(game().state).find((p) => p.id === "ann")?.name).toBe("Annie");
      expect(db.select({ author: posts.author }).from(posts).all()).toEqual([{ author: "Annie" }]);
      expect(people.changeMyName("g", "ann@x", "Ann")).toBe("locked");
    });

    it("lets someone change their own name, or holds it under Approve names", () => {
      const { people, store } = setup();
      expect(people.changeMyName("g", "gus@x", "Gus")).toBe("renamed");
      store.change("g", () => ({ approveNames: true }));
      expect(people.changeMyName("g", "gus@x", "Gussie")).toBe("held");
      expect(people.nameIn("g", "gus@x", store.get("g")!)).toEqual({ name: "Gus", locked: false, pending: "Gussie" });
    });
  });
});
