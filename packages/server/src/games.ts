import { eq } from "drizzle-orm";
import { gameEvents, gameHosts, gameNames, gamePlayers, games, gameVisitors, postReactions, posts, turnClocks, votes, type Db, type Tx } from "./db.js";

/** Something that keeps a copy of some of each Game in memory, and can let a Game's copy go. */
interface Remembers {
  forget: (gameId: string) => void;
}

/**
 * A Game's lifecycle: creating one, and letting it go from memory or deleting it for good. The one place that knows
 * every part a Game is made of: its rows (the Game, its log, its People, Names, Posts, Reactions, votes, turn clocks,
 * who opened it), the copies in memory (the Game store, the Feed, People), and its files (Photos, Theme images).
 * What the statistics and feedback keep outlives a Game on purpose (ADR 0005).
 */
export function createGameLifecycle(deps: {
  db: Db;
  /** The Game store, which also decides which Games are idle. */
  store: Remembers & {
    forgetIdle: (before: number, isWatched: (id: string) => boolean, others?: Iterable<string>) => string[];
  };
  feed: Remembers & { held: () => Iterable<string> };
  people: Remembers & { addHost: (tx: Tx, gameId: string, email: string) => void };
  photos: { removeGame: (gameId: string) => void };
  themeImages: { remove: (owner: string, kind: "logo" | "background") => void };
  /** The Game's last word in the statistics, taken just before it's deleted. */
  lastWord: (gameId: string) => void;
}) {
  const { db, store, feed, people, photos, themeImages, lastWord } = deps;

  /** Every table with rows of a Game, children first. */
  const parts = [votes, postReactions, posts, gameNames, gameVisitors, turnClocks, gamePlayers, gameHosts, gameEvents] as const;

  /** Lets go of every copy of the Game in memory; the database keeps it, and the next request rebuilds it. */
  function forget(id: string) {
    store.forget(id);
    feed.forget(id);
    people.forget(id);
  }

  return {
    /**
     * Creates a Game with its Host. `alsoWrite` goes in the same transaction (such as the Host's saved options), so
     * a Game never exists without its Host, nor the other way round.
     */
    create(row: typeof games.$inferInsert, hostEmail: string, alsoWrite?: (tx: Tx) => void) {
      db.transaction((tx) => {
        tx.insert(games).values(row).run();
        people.addHost(tx, row.id, hostEmail);
        alsoWrite?.(tx);
      });
    },

    forget,

    /** Removes a Game and everything kept for it, in the database, in memory and on disk. */
    remove(id: string) {
      lastWord(id);
      db.transaction((tx) => {
        for (const table of parts) tx.delete(table).where(eq(table.gameId, id)).run();
        tx.delete(games).where(eq(games.id, id)).run();
      });
      forget(id);
      photos.removeGame(id);
      for (const kind of ["logo", "background"] as const) themeImages.remove(`game-${id}`, kind);
    },

    /**
     * Lets go of the Games kept in memory that nobody has asked for since `before` and no screen is watching. Over a
     * busy December that's thousands of finished parties; one opened again is simply rebuilt. Returns how many.
     */
    forgetIdle(before: number, isWatched: (id: string) => boolean): number {
      const gone = store.forgetIdle(before, isWatched, feed.held());
      for (const id of gone) forget(id);
      return gone.length;
    },
  };
}

export type GameLifecycle = ReturnType<typeof createGameLifecycle>;
