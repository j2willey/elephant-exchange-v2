import { afterEach, describe, expect, it, vi } from "vitest";
import { createFeed, type Viewer } from "../src/feed.js";
import { games, openDb, posts } from "../src/db.js";

type Row = typeof posts.$inferInsert;

/** A Feed on a fresh database with one Game, "g"; every signal recorded. */
function setup(signalMs = 0) {
  const db = openDb(":memory:");
  db.insert(games).values({ id: "g", settings: "{}", createdAt: new Date() }).run();
  const signals: string[] = [];
  const feed = createFeed({ db, signal: (id) => signals.push(id), signalMs });
  let n = 0;
  const add = (row: Partial<Row> & { id: string }) =>
    db
      .insert(posts)
      .values({ gameId: "g", email: "ann@x", author: "Ann", text: row.id, status: "visible", createdAt: new Date(1000 + n++), ...row })
      .run();
  return { db, feed, signals, add };
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
