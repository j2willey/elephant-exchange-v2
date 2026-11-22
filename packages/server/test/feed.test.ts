import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFeed, type Viewer } from "../src/feed.js";
import { gameNames, games, openDb, posts } from "../src/db.js";
import { createGameStore } from "../src/game-store.js";
import { photoStore } from "../src/photos.js";

type Row = typeof posts.$inferInsert;

/** A Feed on a fresh database with one Game, "g"; every signal recorded. */
function setup(signalMs = 0) {
  const db = openDb(":memory:");
  db.insert(games).values({ id: "g", settings: JSON.stringify({ activeSlots: 1, maxSteals: 3 }), createdAt: new Date() }).run();
  const signals: string[] = [];
  const now = () => new Date();
  const store = createGameStore({ db, now, draw: (c) => c[0]!, orgTheme: () => null });
  const photos = photoStore(mkdtempSync(join(tmpdir(), "feed-test-")));
  // Who's Muted is People's; here it's read straight from the Names table the tests write.
  const mutedIn = (gameId: string) =>
    new Set(db.select().from(gameNames).all().filter((r) => r.gameId === gameId && r.muted).map((r) => r.email));
  const muted = { mutedIn, isMuted: (gameId: string, email: string) => mutedIn(gameId).has(email) };
  const feed = createFeed({ db, now, store, photos, muted, signal: (id) => void signals.push(id), signalMs });
  let n = 0;
  const add = (row: Partial<Row> & { id: string }) =>
    db
      .insert(posts)
      .values({ gameId: "g", email: "ann@x", author: "Ann", text: row.id, status: "visible", createdAt: new Date(1000 + n++), ...row })
      .run();
  return { db, feed, store, signals, add };
}

const STAFF: Viewer = { email: "host@x", staff: true };
const ANN: Viewer = { email: "ann@x", staff: false };
const BOB: Viewer = { email: "bob@x", staff: false };
const NOBODY: Viewer = { email: undefined, staff: false };

describe("The Feed", () => {
  afterEach(() => void vi.useRealTimers());

  it("shows visible Posts to everyone, a Pending or Hidden one only to its poster and the Staff", () => {
    const { feed, add } = setup();
    add({ id: "seen" });
    add({ id: "waiting", status: "pending" });
    add({ id: "hidden", status: "hidden" });

    const ids = (v: Viewer) => feed.list("g", v).map((p) => p.id);
    expect(ids(STAFF)).toEqual(["hidden", "waiting", "seen"]);
    expect(ids(ANN)).toEqual(["hidden", "waiting", "seen"]);
    expect(ids(BOB)).toEqual(["seen"]);
    expect(ids(NOBODY)).toEqual(["seen"]);
  });

  it("quotes the Post a reply answers only to someone who may see it, and counts only replies everyone sees", () => {
    const { feed, add } = setup();
    add({ id: "first", status: "hidden" });
    add({ id: "reply", email: "bob@x", author: "Bob", replyTo: "first" });
    add({ id: "waiting", email: "bob@x", author: "Bob", replyTo: "first", status: "pending" });

    const reply = (v: Viewer) => feed.list("g", v).find((p) => p.id === "reply")!.replyTo;
    expect(reply(BOB)).toEqual({ id: "first", removed: true });
    expect(reply(ANN)).toMatchObject({ id: "first", author: "Ann", text: "first" });
    expect(feed.list("g", STAFF).find((p) => p.id === "first")!.replies).toBe(1);
  });

  describe("says why it won't take a Post", () => {
    const ann = { email: "ann@x", staff: false };
    const host = { email: "host@x", staff: true };

    it("while posting is Paused, or for someone Muted", () => {
      const { db, feed, store } = setup();
      db.insert(gameNames).values({ gameId: "g", email: "ann@x", name: "Ann", muted: true }).run();
      expect(feed.post("g", ann, { author: "Ann", text: "Hi" })).toMatchObject({ refused: "Muted" });
      store.change("g", () => ({ moderation: "paused" }));
      expect(feed.post("g", host, { author: "Host", text: "Hi" })).toMatchObject({ refused: "Paused" });
    });

    it("past the Feed limit, saying how long to wait, but never for the Staff", () => {
      const { feed, store } = setup();
      store.change("g", () => ({ postsPerMinute: 2 }));
      for (const text of ["one", "two"]) expect(feed.post("g", ann, { author: "Ann", text })).toHaveProperty("id");
      expect(feed.post("g", ann, { author: "Ann", text: "three" })).toMatchObject({ refused: "TooSoon", wait: expect.any(Number) });
      for (const text of ["one", "two", "three"]) expect(feed.post("g", host, { author: "Host", text })).toHaveProperty("id");
    });

    it("about a Gift not in the Game, or in reply to a Post that isn't visible", () => {
      const { feed, add } = setup();
      add({ id: "hidden", status: "hidden" });
      expect(feed.post("g", ann, { author: "Ann", text: "Hi", giftId: "nope" })).toMatchObject({ refused: "Invalid" });
      expect(feed.post("g", ann, { author: "Ann", text: "Hi", replyTo: "hidden" })).toMatchObject({ refused: "Invalid" });
      expect(feed.react("g", "ann@x", "hidden", "👍", true)).toMatchObject({ refused: "NotFound" });
    });

    it("and holds a Post for approval under Approval, unless the Staff wrote it", () => {
      const { feed, store } = setup();
      store.change("g", () => ({ moderation: "approval" }));
      feed.post("g", ann, { author: "Ann", text: "mine" });
      feed.post("g", host, { author: "Host", text: "staff" });
      expect(feed.list("g", host).map((p) => [p.text, p.status])).toEqual([
        ["staff", "visible"],
        ["mine", "pending"],
      ]);
    });
  });

  describe("Pitches", () => {
    /** Ann and Bob are Players; Ann opened g1. */
    function withGift() {
      const t = setup();
      for (const p of ["ann", "bob"]) t.store.command("g", { type: "AddPlayer", playerId: p, name: p.toUpperCase() });
      t.store.command("g", { type: "StartGame" });
      t.store.command("g", { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });
      return t;
    }
    const ann = { email: "ann@x", staff: false, playerId: "ann" };
    const bob = { email: "bob@x", staff: false, playerId: "bob" };
    const host = { email: "host@x", staff: true, playerId: undefined };

    it("lets the holder write their own part, the Staff write it for them, and nobody else", () => {
      const { feed } = withGift();
      expect(feed.writePitch("g", bob, "g1", { tagline: "", text: "Mine now?" })).toMatchObject({ refused: "NotHolder" });
      expect(feed.writePitch("g", bob, "g1", { playerId: "ann", tagline: "", text: "x" })).toMatchObject({ refused: "NotYours" });
      expect(feed.writePitch("g", ann, "g1", { tagline: "Cozy", text: "Warm socks" })).toEqual({ created: true });
      expect(feed.writePitch("g", host, "g1", { playerId: "ann", tagline: "Cozy!", text: "Warm socks" })).toEqual({ created: false });
      expect(feed.list("g", host).map((p) => [p.author, p.tagline])).toEqual([["ANN", "Cozy!"]]);
    });

    it("sends a part back to the top no more often than the Game allows, unless the Staff do", () => {
      const { feed, store } = withGift();
      store.change("g", () => ({ repitchMinutes: 5 }));
      feed.writePitch("g", ann, "g1", { tagline: "Cozy", text: "" });
      expect(feed.pitchAgain("g", ann, "g1", undefined)).toMatchObject({ refused: "TooSoon" });
      expect(feed.pitchAgain("g", host, "g1", "ann")).toBeNull();
      expect(feed.pitchAgain("g", bob, "g1", undefined)).toMatchObject({ refused: "NotFound" });
    });
  });

  it("keeps one shared copy until it changes", () => {
    const { feed, add } = setup();
    add({ id: "one" });
    expect(feed.list("g", NOBODY)).toHaveLength(1);
    add({ id: "two" });
    expect(feed.list("g", NOBODY)).toHaveLength(1); // still the shared copy

    feed.changed("g");
    expect(feed.list("g", NOBODY)).toHaveLength(2);
  });

  it("signals every change at once when there's no wait", () => {
    const { feed, signals } = setup(0);
    feed.changed("g");
    feed.changed("g");
    expect(signals).toEqual(["g", "g"]);
  });

  it("signals at most once a wait, the first at once and the rest gathered into one at its end", () => {
    vi.useFakeTimers();
    const { feed, signals } = setup(1000);

    feed.changed("g");
    feed.changed("g");
    feed.changed("g");
    expect(signals).toEqual(["g"]);

    vi.advanceTimersByTime(1000);
    expect(signals).toEqual(["g", "g"]);
    vi.advanceTimersByTime(1000); // nothing changed in that wait
    expect(signals).toEqual(["g", "g"]);

    feed.changed("g");
    expect(signals).toEqual(["g", "g", "g"]);
    feed.stop();
  });
});
