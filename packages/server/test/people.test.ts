import { describe, expect, it } from "vitest";
import { DEMO_ACTOR } from "../src/access.js";
import { gameHosts, games, openDb } from "../src/db.js";
import { createPeople } from "../src/people.js";

type FakeGame = { roster: string[] };

/** People on a fresh database with one Game, "g", hosted by host@x; Ann, Bob and the Host's own Player "hal" on its Roster. */
function setup() {
  const db = openDb(":memory:");
  const game: FakeGame = { roster: ["ann", "bob", "hal"] };
  const people = createPeople<FakeGame>({ db, rosterOf: (g) => g.roster });
  db.transaction((tx) => {
    tx.insert(games).values({ id: "g", settings: "{}", createdAt: new Date() }).run();
    people.addHost(tx, "g", "host@x");
  });
  /** The same database, read afresh: what a restarted server would know. */
  const fresh = () => createPeople<FakeGame>({ db, rosterOf: (g) => g.roster });
  return { db, game, people, fresh };
}

describe("People in a Game", () => {
  it("knows the Host, and lets them play as a Player with a turn like anyone's", () => {
    const { game, people, fresh } = setup();
    people.setStaff("g", "host@x", { playsAs: "hal" });

    expect(people.roleIn("g", "host@x")).toBe("host");
    expect(people.staffOf("g", game)).toEqual([{ email: "host@x", playerId: "hal", role: "host" }]);
    expect(fresh().staffOf("g", game)).toEqual(people.staffOf("g", game));
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
    const { game, people, fresh } = setup();
    people.addCohost("g", "pat@x", "bob");
    expect(people.staffOf("g", game)).toContainEqual({ email: "pat@x", playerId: "bob", role: "cohost" });
    expect(fresh().roleIn("g", "pat@x")).toBe("cohost");
  });

  it("knows who joined as which Player, only while that Player is on the Roster", () => {
    const { db, game, people, fresh } = setup();
    db.transaction((tx) => people.linkPlayer(tx, "g", "ann", "ann@x"));

    expect(people.playerOf("g", "ann@x", game)).toBe("ann");
    expect(people.emailOfPlayer("g", "ann")).toBe("ann@x");
    expect(fresh().playerOf("g", "ann@x", game)).toBe("ann");
    expect(people.playerOf("g", "ann@x", { roster: ["bob"] })).toBeUndefined();
  });

  it("moves someone who joins again to their new Player", () => {
    const { db, game, people } = setup();
    db.transaction((tx) => people.linkPlayer(tx, "g", "ann", "ann@x"));
    db.transaction((tx) => people.linkPlayer(tx, "g", "bob", "ann@x"));
    expect(people.playerOf("g", "ann@x", game)).toBe("bob");
    expect(people.emailOfPlayer("g", "ann")).toBeUndefined();
  });

  it("knows a demo stand-in identity as its Player", () => {
    const { game, people } = setup();
    expect(people.playerOf("g", `${DEMO_ACTOR}bob`, game)).toBe("bob");
    expect(people.playerOf("g", `${DEMO_ACTOR}zed`, game)).toBeUndefined();
  });

  it("isn't left believing a write that was rolled back", () => {
    const { db, game, people } = setup();
    people.roleIn("g", "host@x"); // the Game's people are now in memory
    expect(() =>
      db.transaction((tx) => {
        people.linkPlayer(tx, "g", "ann", "ann@x");
        expect(people.playerOf("g", "ann@x", game)).toBe("ann"); // seen inside the transaction
        throw new Error("the Pick was refused");
      }),
    ).toThrow();
    people.changed("g");
    expect(people.playerOf("g", "ann@x", game)).toBeUndefined();
  });

  it("reads a Game's people once, until they change", () => {
    const { db, people } = setup();
    expect(people.roleIn("g", "sly@x")).toBeUndefined();
    db.insert(gameHosts).values({ gameId: "g", email: "sly@x", role: "cohost" }).run(); // behind People's back
    expect(people.roleIn("g", "sly@x")).toBeUndefined(); // still the copy in memory
    people.changed("g");
    expect(people.roleIn("g", "sly@x")).toBe("cohost");
  });
});
