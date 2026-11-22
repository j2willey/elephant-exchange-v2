import { randomBytes } from "node:crypto";
import { gifts, phase, roster } from "@elephant/rules";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { gameNames, postReactions, posts, type Db } from "./db.js";
import type { GameStore } from "./game-store.js";
import type { photoStore } from "./photos.js";
import { REACTIONS } from "./schemas.js";

/**
 * Why the Feed said no. The routes turn the code into an HTTP status; `message` is said to the person as is.
 * - Paused, Muted: posting is switched off for the Game, or for this person.
 * - TooSoon: past the Feed limit; `wait` seconds until they may.
 * - Invalid: something asked for doesn't fit (no such Gift, a Post that can't be replied to).
 * - NotFound: no such Post, or not one this person may see.
 * - NotYours: only its poster or the Staff may.
 * - NotHolder: only the Gift's holder may.
 * - GameOver: Pitches can't change once the Game has ended.
 */
export type Refusal = {
  refused: "Paused" | "Muted" | "TooSoon" | "Invalid" | "NotFound" | "NotYours" | "NotHolder" | "GameOver";
  message: string;
  wait?: number;
};
const refuse = (refused: Refusal["refused"], message: string, more: { wait?: number } = {}): Refusal => ({ refused, message, ...more });
export const isRefusal = (r: unknown): r is Refusal => typeof r === "object" && r !== null && "refused" in r;

/** A Photo ready to keep: the full and the small version, and its size. */
export interface ReadyPhoto {
  data: Buffer;
  small?: Buffer | undefined;
  width: number;
  height: number;
}

/** Who is looking at, or acting on, a Game's Feed. `staff` is the Host or a Co-host. */
export interface Viewer {
  email: string | undefined;
  staff: boolean;
}

export type PostRow = typeof posts.$inferSelect;

/** Someone writing a Pitch: signed in, and the Player they are in this Game, if any. */
export type PitchViewer = Viewer & { email: string; playerId: string | undefined };

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
export function createFeed(deps: {
  db: Db;
  now: () => Date;
  /** Where Game facts come from: Moderation, the Feed limits, the Gifts. */
  store: GameStore;
  photos: ReturnType<typeof photoStore>;
  signal: (gameId: string) => void;
  signalMs: number;
}) {
  const { db, now, store, photos, signal, signalMs } = deps;
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

  const isMuted = (id: string, email: string) =>
    db.select({ muted: gameNames.muted }).from(gameNames).where(and(eq(gameNames.gameId, id), eq(gameNames.email, email))).get()?.muted ?? false;

  /**
   * Seconds this person must still wait before posting again (0: they may post now): at most the Game's Posts a
   * minute, so a few quick replies are fine but nobody floods the Feed. The Staff are never held back.
   */
  function tooSoon(id: string, viewer: Viewer, postsPerMinute: number): number {
    if (postsPerMinute === 0 || viewer.staff || !viewer.email) return 0;
    const minuteAgo = new Date(now().getTime() - 60_000);
    const recent = db
      .select({ at: posts.createdAt })
      .from(posts)
      .where(and(eq(posts.gameId, id), eq(posts.email, viewer.email), gt(posts.createdAt, minuteAgo)))
      .orderBy(desc(posts.createdAt))
      .all();
    if (recent.length < postsPerMinute) return 0;
    // Once the oldest of the last allowed few is a minute old, there's room again.
    const oldest = recent[postsPerMinute - 1]!.at.getTime();
    return Math.max(1, Math.ceil((oldest + 60_000 - now().getTime()) / 1000));
  }

  /**
   * Whether this person may post now (not while the Game's posting is Paused, nor when they're Muted, nor past the
   * Feed limit), about this Gift, in reply to this Post. Checked before any work on a Post (its name, its Photo);
   * `post` checks again.
   */
  function mayPost(id: string, viewer: Viewer & { email: string }, about: { giftId?: string | undefined; replyTo?: string | undefined } = {}): Refusal | null {
    const game = store.get(id)!;
    if (game.moderation === "paused") return refuse("Paused", "The Host has paused posting");
    if (isMuted(id, viewer.email)) return refuse("Muted", "The Host has paused your posting");
    const wait = tooSoon(id, viewer, game.postsPerMinute);
    if (wait > 0) return refuse("TooSoon", `Wait ${wait} seconds before posting again`, { wait });
    const { giftId, replyTo } = about;
    if (giftId !== undefined && !gifts(game.state).some((g) => g.id === giftId)) return refuse("Invalid", "No such Gift in this Game");
    if (
      replyTo !== undefined &&
      !db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.gameId, id), eq(posts.id, replyTo), eq(posts.status, "visible")))
        .get()
    )
      return refuse("Invalid", "That Post can't be replied to");
    return null;
  }

  /**
   * Puts a Post up, under `author` (the name the person goes by in this Game), about a Gift or as a reply if asked.
   * Under Approval it waits for the Staff, unless they wrote it. Returns its id.
   */
  function post(
    id: string,
    viewer: Viewer & { email: string },
    input: { author: string; text: string; giftId?: string | undefined; replyTo?: string | undefined; photo?: ReadyPhoto | undefined },
  ): Refusal | { id: string } {
    const { author, text, giftId, replyTo, photo } = input;
    const no = mayPost(id, viewer, { giftId, replyTo });
    if (no) return no;
    const game = store.get(id)!;
    // Under Approval the Host and Co-hosts are the approvers: their own Posts go up at once.
    const status = game.moderation === "approval" && !viewer.staff ? "pending" : "visible";
    const postId = randomBytes(12).toString("base64url");
    if (photo) photos.save(id, postId, photo.data, photo.small);
    try {
      db.insert(posts)
        .values({
          id: postId,
          gameId: id,
          email: viewer.email,
          author,
          giftId: giftId ?? null,
          replyTo: replyTo ?? null,
          text,
          photoWidth: photo?.width ?? null,
          photoHeight: photo?.height ?? null,
          status,
          createdAt: now(),
        })
        .run();
    } catch (err) {
      if (photo) photos.remove(id, postId);
      throw err;
    }
    changed(id);
    return { id: postId };
  }

  /** Adds or takes back this person's Reaction to a visible Post. */
  function react(id: string, email: string, postId: string, emoji: (typeof REACTIONS)[number], on: boolean): Refusal | null {
    const target = db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.gameId, id), eq(posts.id, postId), eq(posts.status, "visible")))
      .get();
    if (!target) return refuse("NotFound", "Post not found");
    const done = on
      ? db.insert(postReactions).values({ gameId: id, postId, email, emoji }).onConflictDoNothing().run()
      : db
          .delete(postReactions)
          .where(and(eq(postReactions.postId, postId), eq(postReactions.email, email), eq(postReactions.emoji, emoji)))
          .run();
    if (done.changes > 0) changed(id);
    return null;
  }

  /**
   * The part of a Gift's Pitch a request is about, and whether this person may touch it: the holder their own part,
   * the Staff any part (for a guest without a phone), and not once the Game is over, Paused, or for someone Muted
   * (the Staff aside).
   */
  function pitchPart(id: string, viewer: PitchViewer, giftId: string, playerIdAsked: string | undefined) {
    const game = store.get(id)!;
    const gift = gifts(game.state).find((g) => g.id === giftId);
    if (!gift) return refuse("NotFound", "No such Gift in this Game");
    const playerId = playerIdAsked ?? viewer.playerId;
    if (!playerId) return refuse("NotHolder", "Only the Gift's holder writes its pitch");
    if (!viewer.staff && playerId !== viewer.playerId) return refuse("NotYours", "You can only write your own part");
    const part = db
      .select()
      .from(posts)
      .where(and(eq(posts.gameId, id), eq(posts.giftId, giftId), eq(posts.pitchFor, playerId)))
      .get();
    if (!viewer.staff) {
      if (phase(game.state) === "ended") return refuse("GameOver", "The Game is over");
      if (game.moderation === "paused") return refuse("Paused", "The Host has paused posting");
      if (isMuted(id, viewer.email)) return refuse("Muted", "The Host has paused your posting");
    }
    return { game, gift, playerId, part };
  }

  /** Whether this person may write this part of a Gift's Pitch now; checked before any work on its Photo. */
  function mayPitch(id: string, viewer: PitchViewer, giftId: string, playerIdAsked: string | undefined): Refusal | null {
    const found = pitchPart(id, viewer, giftId, playerIdAsked);
    if (isRefusal(found)) return found;
    // A new part only from the Gift's holder; an existing one may still be changed after the Gift moves on.
    if (!found.part && found.gift.holderId !== found.playerId) return refuse("NotHolder", "Only the Gift's holder writes its pitch");
    return null;
  }

  /**
   * Writes, changes or removes (nothing left: no tagline, words or Photo) a part of a Gift's Pitch. Changed words
   * wait again under Approval; a part the Staff hid stays hidden. Says whether a new part was written.
   */
  function writePitch(
    id: string,
    viewer: PitchViewer,
    giftId: string,
    input: { playerId?: string | undefined; tagline: string; text: string; removePhoto?: boolean | undefined; photo?: ReadyPhoto | undefined },
  ): Refusal | { created: boolean } {
    const no = mayPitch(id, viewer, giftId, input.playerId);
    if (no) return no;
    const { game, playerId, part } = pitchPart(id, viewer, giftId, input.playerId) as Exclude<ReturnType<typeof pitchPart>, Refusal>;
    const { tagline, text, removePhoto, photo } = input;
    const keepsPhoto = Boolean(photo) || (Boolean(part?.photoWidth) && !removePhoto);
    if (!tagline && !text && !keepsPhoto) {
      if (part) {
        db.delete(posts).where(eq(posts.id, part.id)).run();
        if (part.photoWidth) photos.remove(id, part.id);
        changed(id);
      }
      return { created: false };
    }
    const waits = !viewer.staff && game.moderation === "approval";
    const postId = part?.id ?? randomBytes(12).toString("base64url");
    if (photo) photos.save(id, postId, photo.data, photo.small);
    const pictured = photo ? { photoWidth: photo.width, photoHeight: photo.height } : removePhoto ? { photoWidth: null, photoHeight: null } : {};
    if (part) {
      const differs = part.text !== text || (part.tagline ?? "") !== tagline || photo !== undefined || (removePhoto && part.photoWidth !== null);
      if (differs) {
        const status = part.status === "hidden" ? "hidden" : waits ? "pending" : part.status;
        db.update(posts)
          .set({ text, tagline: tagline || null, status, ...pictured })
          .where(eq(posts.id, part.id))
          .run();
        if (removePhoto && !photo && part.photoWidth) photos.remove(id, part.id);
      }
    } else {
      db.insert(posts)
        .values({
          id: postId,
          gameId: id,
          email: viewer.email,
          author: roster(game.state).find((p) => p.id === playerId)!.name,
          giftId,
          pitchFor: playerId,
          tagline: tagline || null,
          text,
          photoWidth: photo?.width ?? null,
          photoHeight: photo?.height ?? null,
          status: waits ? "pending" : "visible",
          createdAt: now(),
        })
        .run();
    }
    changed(id);
    return { created: !part };
  }

  /**
   * "Pitch it again": the Gift's holder sends their part back to the top of the Feed. Not more often than the Game
   * allows, so nobody bombards the Feed; the Staff may do it any time, for any holder.
   */
  function pitchAgain(id: string, viewer: PitchViewer, giftId: string, playerIdAsked: string | undefined): Refusal | null {
    const found = pitchPart(id, viewer, giftId, playerIdAsked);
    if (isRefusal(found)) return found;
    const { game, gift, playerId, part } = found;
    if (!part || part.status !== "visible") return refuse("NotFound", "There's no pitch to send again");
    if (gift.holderId !== playerId) return refuse("NotHolder", "Only the Gift's holder pitches it again");
    const last = (part.bumpedAt ?? part.createdAt).getTime();
    const wait = viewer.staff ? 0 : Math.ceil((last + game.repitchMinutes * 60_000 - now().getTime()) / 1000);
    if (wait > 0) return refuse("TooSoon", `You can pitch it again in ${Math.ceil(wait / 60)} min`, { wait });
    db.update(posts).set({ bumpedAt: now() }).where(eq(posts.id, part.id)).run();
    changed(id);
    return null;
  }

  /** Lets go of a Game's shared copy (the database keeps it). */
  const forget = (id: string) => void feeds.delete(id);

  return {
    list,
    mayPost,
    post,
    react,
    mayPitch,
    writePitch,
    pitchAgain,
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
