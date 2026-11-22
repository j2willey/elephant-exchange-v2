import { and, eq, sql } from "drizzle-orm";
import { DEMO_ACTOR, type Role } from "./access.js";
import { gameHosts, gamePlayers, type Db, type Tx } from "./db.js";

/** Who someone is in one Game, as kept in memory: the Staff with the Player each plays as, and who joined as which Player. */
interface GamePeople {
  /** The Host and Co-hosts, by email, with the Player the Host said they play as (null: not said). */
  staff: Map<string, { role: Role; playerId: string | null }>;
  /** Who joined (or was given a demo stand-in) as which Player, by email. */
  players: Map<string, string>;
}

/**
 * People in a Game: who someone is there (a Player, a Guest, a demo stand-in), and their role.
 *
 * Asked on nearly every request, so each Game's Staff and Players are kept in memory once read. Every write to
 * them goes through here and drops that Game's copy, which is read again on the next question: a write inside
 * someone else's transaction that's later rolled back can't leave the copy wrong.
 */
export function createPeople<G>(deps: {
  db: Db;
  /** The ids of the Players on a Game's Roster. */
  rosterOf: (game: G) => readonly string[];
}) {
  const { db, rosterOf } = deps;
  const known = new Map<string, GamePeople>();

  const staffQuery = db
    .select({ email: gameHosts.email, role: gameHosts.role, playerId: gameHosts.playerId })
    .from(gameHosts)
    .where(eq(gameHosts.gameId, sql.placeholder("gameId")))
    .prepare();
  const playersQuery = db
    .select({ email: gamePlayers.email, playerId: gamePlayers.playerId })
    .from(gamePlayers)
    .where(eq(gamePlayers.gameId, sql.placeholder("gameId")))
    .prepare();

  function of(gameId: string): GamePeople {
    let people = known.get(gameId);
    if (!people) {
      people = {
        staff: new Map(staffQuery.all({ gameId }).map((h) => [h.email, { role: h.role, playerId: h.playerId }])),
        players: new Map(playersQuery.all({ gameId }).map((p) => [p.email, p.playerId])),
      };
      known.set(gameId, people);
    }
    return people;
  }

  /** After any write to a Game's Staff or Players (also after a transaction that may have rolled back). */
  const changed = (gameId: string) => void known.delete(gameId);
  /** Runs a write, then drops the Game's copy whether it succeeded or not. */
  function writing<T>(gameId: string, write: () => T): T {
    try {
      changed(gameId);
      return write();
    } finally {
      changed(gameId);
    }
  }

  /** This person's role in the Game: the Host, a Co-host, or none. */
  const roleIn = (gameId: string, email: string): Role | undefined => of(gameId).staff.get(email)?.role;

  /** The Player this person signed up as (or a demo stand-in is), if they did and are still on the Roster. */
  function playerOf(gameId: string, email: string, game: G): string | undefined {
    const playerId = email.startsWith(DEMO_ACTOR) ? email.slice(DEMO_ACTOR.length) : of(gameId).players.get(email);
    return playerId !== undefined && rosterOf(game).includes(playerId) ? playerId : undefined;
  }

  /** The person behind a Player who signed up themselves (or a demo stand-in); none for a Player the Host typed in. */
  function emailOfPlayer(gameId: string, playerId: string): string | undefined {
    for (const [email, id] of of(gameId).players) if (id === playerId) return email;
    return undefined;
  }

  /** The Host and Co-hosts who play in the Game, and as which Player: the one the Host named, or the one they joined as. */
  function staffOf(gameId: string, game: G): { email: string; playerId: string; role: Role }[] {
    const inRoster = new Set(rosterOf(game));
    return [...of(gameId).staff].flatMap(([email, h]) => {
      const playerId = h.playerId ?? playerOf(gameId, email, game);
      return playerId && inRoster.has(playerId) ? [{ email, playerId, role: h.role }] : [];
    });
  }

  /** The Staff, by email, with the Player the Host said each plays as. */
  const staff = (gameId: string): ReadonlyMap<string, { role: Role; playerId: string | null }> => of(gameId).staff;
  /** Emails of everyone who joined as (or stands in for) a Player. */
  const playerEmails = (gameId: string): string[] => [...of(gameId).players.keys()];

  return {
    roleIn,
    playerOf,
    emailOfPlayer,
    staffOf,
    staff,
    playerEmails,

    /** Makes this person the new Game's Host, in the transaction that creates it. */
    addHost: (tx: Tx, gameId: string, email: string) =>
      writing(gameId, () => tx.insert(gameHosts).values({ gameId, email, role: "host" }).run()),

    /**
     * Makes someone a Co-host (switching it off again for a Co-host, never for the Host), and says which Player a
     * Host or Co-host plays as. Both or either.
     */
    setStaff: (gameId: string, email: string, change: { cohost?: boolean | undefined; playsAs?: string | null | undefined }) =>
      writing(gameId, () =>
        db.transaction((tx) => {
          const role = of(gameId).staff.get(email)?.role;
          const at = and(eq(gameHosts.gameId, gameId), eq(gameHosts.email, email));
          if (change.cohost === true && !role) tx.insert(gameHosts).values({ gameId, email, role: "cohost" }).run();
          if (change.cohost === false && role === "cohost") tx.delete(gameHosts).where(at).run();
          if (change.playsAs !== undefined) tx.update(gameHosts).set({ playerId: change.playsAs }).where(at).run();
        }),
      ),

    /** The Host appoints a Co-host by email (who may not have opened the Game yet), playing as a Player or not. */
    addCohost: (gameId: string, email: string, playsAs: string | undefined) =>
      writing(gameId, () => {
        const row = { gameId, email, role: "cohost" as const, ...(playsAs ? { playerId: playsAs } : {}) };
        if (playsAs)
          db.insert(gameHosts)
            .values(row)
            .onConflictDoUpdate({ target: [gameHosts.gameId, gameHosts.email], set: { playerId: playsAs } })
            .run();
        else db.insert(gameHosts).values(row).onConflictDoNothing().run();
      }),

    /** The Host takes someone off the Co-hosts; the Host can't be removed this way. */
    removeCohost: (gameId: string, email: string) =>
      writing(gameId, () =>
        db
          .delete(gameHosts)
          .where(and(eq(gameHosts.gameId, gameId), eq(gameHosts.email, email), eq(gameHosts.role, "cohost")))
          .run(),
      ),

    /** Says who is behind a Player (someone who joined, or a demo stand-in), in the transaction that adds the Player. */
    linkPlayer: (tx: Tx, gameId: string, playerId: string, email: string) =>
      writing(gameId, () => {
        tx.delete(gamePlayers).where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.email, email))).run();
        tx.insert(gamePlayers).values({ gameId, playerId, email }).run();
      }),

    /** After a write elsewhere that may have touched a Game's Staff or Players (a transaction rolled back, a delete). */
    changed,
    /** Lets go of a Game's copy (the database keeps it). */
    forget: changed,
  };
}

export type People<G> = ReturnType<typeof createPeople<G>>;
