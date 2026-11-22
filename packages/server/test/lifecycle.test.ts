import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { roster } from "@elephant/rules";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as tables from "../src/db.js";
import { openDb } from "../src/db.js";
import { createFeed } from "../src/feed.js";
import { createGameStore, type LoadedGame } from "../src/game-store.js";
import { createGameLifecycle } from "../src/games.js";
import { createPeople } from "../src/people.js";
import { photoStore, themeStore } from "../src/photos.js";

/** Every module that keeps part of a Game, on one fresh database and two fresh folders, joined as the server joins them. */
function setup() {
  const db = openDb(":memory:");
  const now = () => new Date();
  const photosDir = mkdtempSync(join(tmpdir(), "lifecycle-photos-"));
  const themesDir = mkdtempSync(join(tmpdir(), "lifecycle-themes-"));
  const photos = photoStore(photosDir);
  const themeImages = themeStore(themesDir);
  const store = createGameStore({ db, now, draw: (c) => c[0]!, orgTheme: () => null });
  const people = createPeople<LoadedGame>({
    db,
    rosterOf: (game) => roster(game.state),
    latest: (id) => store.get(id)!,
    approveNames: (game) => game.approveNames,
    command: (id, cmd, alsoWrite) => store.command(id, cmd, alsoWrite),
    renameAuthor: (tx, id, email, name) => feed.renameAuthor(tx, id, email, name),
    postsChanged: (id) => feed.changed(id),
    staffChanged: () => undefined,
  });
  const feed = createFeed({ db, now, store, photos, muted: people, signal: () => undefined, signalMs: 0 });
  const lastWords: string[] = [];
  const lifecycle = createGameLifecycle({ db, store, feed, people, photos, themeImages, lastWord: (id) => void lastWords.push(id) });
  return { db, store, feed, people, photos, themeImages, lifecycle, lastWords, photosDir, themesDir };
}

/** Every table that holds rows of a Game. */
const gameTables = [tables.gameEvents, tables.gameHosts, tables.gameNames, tables.gamePlayers, tables.gameVisitors, tables.turnClocks, tables.posts, tables.postReactions, tables.votes];

describe("A Game's lifecycle", () => {
  it("deletes a Game with everything in it: its rows, every copy in memory, and its files, but not another Game", () => {
    const t = setup();
    const { db, store, feed, people, lifecycle } = t;
    const make = (id: string) =>
      lifecycle.create({ id, settings: JSON.stringify({ activeSlots: 1, maxSteals: 3 }), createdAt: new Date(), rosterMode: "self" }, "host@x");
    make("doomed");
    make("kept");
    for (const id of ["doomed", "kept"]) {
      // Players (one joined from a phone, one appointed Co-host), a started Game with a Pick, a turn clock.
      expect(people.join(id, "ann@x", "Ann")).toHaveProperty("playerId");
      people.addCohost(id, "co@x", undefined);
      store.command(id, { type: "AddPlayer", playerId: "bob", name: "Bob" });
      store.command(id, { type: "StartGame" });
      const up = store.get(id)!.state.active[0]!;
      store.command(id, { type: "OpenGift", playerId: up, giftId: "g1", name: "Socks" });
      // A Post with a Photo, a Reaction, a Guest's Name, someone who only opened it, a vote, a Theme image.
      const posted = feed.post(id, { email: "gus@x", staff: false }, { author: "Gus", text: "Look!", photo: { data: Buffer.from("jpg"), width: 10, height: 10 } });
      const postId = (posted as { id: string }).id;
      feed.react(id, "ann@x", postId, "👍", true);
      people.changeMyName(id, "gus@x", "Gus");
      db.insert(tables.gameVisitors).values({ gameId: id, email: "viv@x", firstSeenAt: new Date() }).run();
      store.castBallot(id, "ann@x", "g1");
      t.themeImages.save(`game-${id}`, "logo", Buffer.from("png"));
      feed.list(id, { email: undefined, staff: false }); // the Feed's copy in memory
    }
    const rowsOf = (id: string) => gameTables.map((table) => db.select().from(table).where(eq(table.gameId, id)).all().length);
    expect(rowsOf("doomed").every((n) => n > 0)).toBe(true); // every part really was there

    lifecycle.remove("doomed");

    expect(rowsOf("doomed")).toEqual(gameTables.map(() => 0));
    expect(db.select().from(tables.games).where(eq(tables.games.id, "doomed")).all()).toEqual([]);
    expect(store.get("doomed")).toBeUndefined();
    expect([...feed.held()]).not.toContain("doomed");
    expect(people.roleIn("doomed", "host@x")).toBeUndefined();
    expect(readdirSync(t.photosDir)).not.toContain("doomed");
    expect(t.themeImages.read("game-doomed", "logo")).toBeUndefined();
    expect(t.lastWords).toEqual(["doomed"]); // the statistics heard from it first

    // The other Game is untouched.
    expect(rowsOf("kept").every((n) => n > 0)).toBe(true);
    expect(people.roleIn("kept", "host@x")).toBe("host");
    expect(readdirSync(t.photosDir)).toContain("kept");
    expect(t.themeImages.read("game-kept", "logo")).toBeDefined();
  });

  it("lets idle Games go from every copy in memory, keeping the ones a screen watches", () => {
    const { store, feed, people, lifecycle } = setup();
    for (const id of ["idle", "watched"]) {
      lifecycle.create({ id, settings: JSON.stringify({ activeSlots: 1, maxSteals: 3 }), createdAt: new Date() }, "host@x");
      store.get(id);
      feed.list(id, { email: undefined, staff: false });
      people.roleIn(id, "host@x");
    }

    expect(lifecycle.forgetIdle(Date.now() + 1000, (id) => id === "watched")).toBe(1);

    expect(store.size()).toBe(1);
    expect([...feed.held()]).toEqual(["watched"]);
    expect(store.get("idle")).toBeDefined(); // the database still has it, so it's simply rebuilt
  });
});
