import { and, desc, eq, sql } from "drizzle-orm";
import { gameNames, postReactions, posts, type Db } from "./db.js";
import { REACTIONS } from "./schemas.js";

/** Who is looking at, or acting on, a Game's Feed. `staff` is the Host or a Co-host. */
export interface Viewer {
  email: string | undefined;
  staff: boolean;
}

export type PostRow = typeof posts.$inferSelect;

/** Where a Post's Photo can be fetched, and its size; null when it has none. */
export function photoOf(gameId: string, p: Pick<PostRow, "id" | "photoWidth" | "photoHeight">) {
  return p.photoWidth && p.photoHeight
    ? { url: `/api/games/${gameId}/posts/${p.id}/photo.jpg`, smallUrl: `/api/games/${gameId}/posts/${p.id}/photo-small.jpg`, width: p.photoWidth, height: p.photoHeight }
    : null;
}

/** The Feed's one visibility rule: everyone sees visible Posts; a poster sees their own; Staff see them all. */
export function canSee(viewer: Viewer, p: Pick<PostRow, "status" | "email">): boolean {
  return viewer.staff || p.status === "visible" || (viewer.email !== undefined && p.email === viewer.email);
}

/**
 * A Game's Feed: its Posts (replies and Pitch parts among them) and Reactions, as each viewer may see them.
 *
 * Read from the database once and shared by every screen asking, until the Feed changes. Every change goes through
 * `changed`, which drops that copy and tells the screens watching (`signal`): at most one signal every `signalMs`
 * per Game, the first at once and the rest gathered into one at the end. Each screen then asks again, since each may
 * see different Posts.
 */
export function createFeed(deps: { db: Db; signal: (gameId: string) => void; signalMs: number }) {
  const { db, signal, signalMs } = deps;
  const feeds = new Map<string, { rows: PostRow[]; reactions: (typeof postReactions.$inferSelect)[] }>();
  /** Games whose signal waits out signalMs, and whether the Feed changed again meanwhile. */
  const waits = new Map<string, { again: boolean; timer: ReturnType<typeof setTimeout> }>();

  function feedOf(id: string) {
    let feed = feeds.get(id);
    if (!feed) {
      feed = {
        rows: db
          .select()
          .from(posts)
          .where(eq(posts.gameId, id))
          // A Pitch sent again goes back to the top.
          .orderBy(desc(sql`coalesce(${posts.bumpedAt}, ${posts.createdAt})`), desc(sql`${posts}.rowid`))
          .all(),
        reactions: db.select().from(postReactions).where(eq(postReactions.gameId, id)).all(),
      };
      feeds.set(id, feed);
    }
    return feed;
  }

  /** After any change to a Game's Posts or Reactions: drops the shared copy and tells the screens. */
  function changed(id: string) {
    feeds.delete(id);
    if (signalMs <= 0) return signal(id);
    const waiting = waits.get(id);
    if (waiting) {
      waiting.again = true;
      return;
    }
    signal(id);
    const wait = {
      again: false,
      timer: setTimeout(function endOfWait() {
        if (!wait.again) {
          waits.delete(id);
          return;
        }
        wait.again = false;
        signal(id);
        wait.timer = setTimeout(endOfWait, signalMs);
      }, signalMs),
    };
    waits.set(id, wait);
  }

  /** The Feed as this viewer may see it, newest (or most recently pitched again) first. */
  function list(id: string, viewer: Viewer) {
    const { email, staff } = viewer;
    const feed = feedOf(id);
    const rows = feed.rows.filter((p) => canSee(viewer, p));
    // Every Reaction in the Game, tallied per Post in the order they're offered, with the viewer's own marked.
    const tallies = new Map<string, Map<string, { count: number; mine: boolean }>>();
    for (const r of feed.reactions) {
      const tally = tallies.get(r.postId) ?? new Map<string, { count: number; mine: boolean }>();
      const t = tally.get(r.emoji) ?? { count: 0, mine: false };
      tally.set(r.emoji, { count: t.count + 1, mine: t.mine || r.email === email });
      tallies.set(r.postId, tally);
    }
    const reactionsOf = (postId: string) =>
      REACTIONS.flatMap((emoji) => {
        const t = tallies.get(postId)?.get(emoji);
        return t ? [{ emoji, ...t }] : [];
      });
    // A reply quotes the Post it answers, if this viewer may see that Post; otherwise it's shown as removed.
    // Each Post counts its replies that everyone can see.
    const seenById = new Map(rows.map((p) => [p.id, p]));
    const replies = new Map<string, number>();
    for (const p of rows) if (p.replyTo && p.status === "visible") replies.set(p.replyTo, (replies.get(p.replyTo) ?? 0) + 1);
    const mutedPeople = new Set(
      staff
        ? db
            .select({ email: gameNames.email })
            .from(gameNames)
            .where(and(eq(gameNames.gameId, id), eq(gameNames.muted, true)))
            .all()
            .map((r) => r.email)
        : [],
    );
    const quote = (replyTo: string | null) => {
      if (!replyTo) return null;
      const o = seenById.get(replyTo);
      return o ? { id: o.id, author: o.author, text: o.text, photo: photoOf(id, o) } : { id: replyTo, removed: true as const };
    };
    return rows.map((p) => ({
      id: p.id,
      author: p.author,
      giftId: p.giftId,
      text: p.text,
      photo: photoOf(id, p),
      status: p.status,
      createdAt: p.createdAt.getTime(),
      mine: p.email === email,
      reactions: reactionsOf(p.id),
      replyTo: quote(p.replyTo),
      replies: replies.get(p.id) ?? 0,
      // A part of its Gift's Pitch: whose part it is, its headline, and when it was last sent again.
      pitchFor: p.pitchFor,
      tagline: p.tagline,
      bumpedAt: p.bumpedAt?.getTime() ?? null,
      // For the Host and Co-hosts: whether its poster is muted, so they can unmute from here.
      ...(staff ? { authorMuted: mutedPeople.has(p.email) } : {}),
    }));
  }

  /** Lets go of a Game's shared copy (the database keeps it). */
  const forget = (id: string) => void feeds.delete(id);

  return {
    list,
    changed,
    forget,
    /** The Games with a shared copy in memory. */
    held: () => feeds.keys(),
    /** Stops any signal still waiting, as the server shuts down. */
    stop() {
      for (const { timer } of waits.values()) clearTimeout(timer);
      waits.clear();
    },
  };
}

export type Feed = ReturnType<typeof createFeed>;
