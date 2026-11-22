import { createHash } from "node:crypto";
import type { Command } from "@elephant/rules";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { DEMO_ACTOR, type Role } from "./access.js";
import { gameHosts, gameNames, gamePlayers, gameVisitors, postReactions, posts, votes, type Db, type Tx } from "./db.js";
import type { PendingName, Person } from "./wire.js";

/** Why People said no: no such person (or Player) here, or a change that can't be made. */
export type PeopleRefusal = { refused: "NotFound" | "Invalid"; message: string };
const refuse = (refused: PeopleRefusal["refused"], message: string): PeopleRefusal => ({ refused, message });

/** A stable, opaque name for a person in a Game, so the Co-hosts panel never needs their email. */
const personKey = (gameId: string, email: string) => createHash("sha256").update(`${gameId}\n${email}`).digest("base64url").slice(0, 16);
/** Enough of an email to tell two people of the same name apart: "te…@example.com". */
const emailHint = (email: string) => {
  const at = email.lastIndexOf("@");
  return `${email.slice(0, Math.min(2, at))}…${email.slice(at)}`;
};

/** What others see in place of a name that's waiting for approval. */
export const WAITING_PLAYER = "New player";
export const WAITING_GUEST = "Guest";

/** The name someone goes by in a Game (null until a Guest gives one), whether the Staff locked it, and one waiting. */
export interface MyName {
  name: string | null;
  locked: boolean;
  pending: string | null;
}

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
  /** The Players on a Game's Roster. */
  rosterOf: (game: G) => readonly { id: string; name: string }[];
  /** The Game as it stands now (it must exist). */
  latest: (gameId: string) => G;
  /** Whether the Host has switched on Approve names. */
  approveNames: (game: G) => boolean;
  /** Logs a command for the Game, with `alsoWrite` in the same transaction (the Game store). */
  command: (gameId: string, cmd: Command, alsoWrite: (tx: Tx) => void) => unknown;
  /** Puts a new name on everything this person posted (the Feed). */
  renameAuthor: (tx: Tx, gameId: string, email: string, name: string) => void;
  /** Tell the screens watching: the Feed changed; the Staff (or a waiting name) changed. */
  postsChanged: (gameId: string) => void;
  staffChanged: (gameId: string) => void;
}) {
  const { db, latest, approveNames, command, renameAuthor, postsChanged, staffChanged } = deps;
  const rosterIds = (game: G) => deps.rosterOf(game).map((p) => p.id);
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
    return playerId !== undefined && rosterIds(game).includes(playerId) ? playerId : undefined;
  }

  /** The person behind a Player who signed up themselves (or a demo stand-in); none for a Player the Host typed in. */
  function emailOfPlayer(gameId: string, playerId: string): string | undefined {
    for (const [email, id] of of(gameId).players) if (id === playerId) return email;
    return undefined;
  }

  /** The Host and Co-hosts who play in the Game, and as which Player: the one the Host named, or the one they joined as. */
  function staffOf(gameId: string, game: G): { email: string; playerId: string; role: Role }[] {
    const inRoster = new Set(rosterIds(game));
    return [...of(gameId).staff].flatMap(([email, h]) => {
      const playerId = h.playerId ?? playerOf(gameId, email, game);
      return playerId && inRoster.has(playerId) ? [{ email, playerId, role: h.role }] : [];
    });
  }

  /** The Staff, by email, with the Player the Host said each plays as. */
  const staff = (gameId: string): ReadonlyMap<string, { role: Role; playerId: string | null }> => of(gameId).staff;
  /** Emails of everyone who joined as (or stands in for) a Player. */
  const playerEmails = (gameId: string): string[] => [...of(gameId).players.keys()];

  /**
   * Makes someone a Co-host (switching it off again for a Co-host, never for the Host), and says which Player a
   * Host or Co-host plays as. Both or either.
   */
  const setStaff = (gameId: string, email: string, change: { cohost?: boolean | undefined; playsAs?: string | null | undefined }) =>
    writing(gameId, () =>
      db.transaction((tx) => {
        const role = of(gameId).staff.get(email)?.role;
        const at = and(eq(gameHosts.gameId, gameId), eq(gameHosts.email, email));
        if (change.cohost === true && !role) tx.insert(gameHosts).values({ gameId, email, role: "cohost" }).run();
        if (change.cohost === false && role === "cohost") tx.delete(gameHosts).where(at).run();
        if (change.playsAs !== undefined) tx.update(gameHosts).set({ playerId: change.playsAs }).where(at).run();
      }),
    );

  const nameQuery = db
    .select()
    .from(gameNames)
    .where(and(eq(gameNames.gameId, sql.placeholder("gameId")), eq(gameNames.email, sql.placeholder("email"))))
    .prepare();
  /** What's kept about this person's name in the Game: a Guest's name, one waiting, locked, Muted. */
  const nameRow = (gameId: string, email: string) => nameQuery.get({ gameId, email });

  const playerName = (game: G, playerId: string) => deps.rosterOf(game).find((p) => p.id === playerId)?.name;

  /** The name someone goes by in a Game (a Player's Roster name, or a Guest's), and whether it's locked. */
  function nameIn(gameId: string, email: string, game: G): MyName {
    const playerId = playerOf(gameId, email, game);
    const row = nameRow(gameId, email);
    const name = playerId ? (playerName(game, playerId) ?? null) : (row?.name ?? null);
    return { name, locked: row?.locked ?? false, pending: row?.pending ?? null };
  }

  /** Under Approve names, whether a name this person picks for themselves waits for the Staff (theirs never do). */
  const needsApproval = (gameId: string, email: string, game: G): boolean => approveNames(game) && !roleIn(gameId, email);

  /** Puts the name someone asked for aside until the Staff approve it, and tells their screens. */
  function holdName(gameId: string, email: string, wants: string) {
    db.insert(gameNames)
      .values({ gameId, email, pending: wants })
      .onConflictDoUpdate({ target: [gameNames.gameId, gameNames.email], set: { pending: wants } })
      .run();
    staffChanged(gameId);
  }

  /**
   * Gives someone a new name everywhere: on the Roster if they're a Player, and on every Post they've made, so an
   * unkind name doesn't linger in the Feed. `locked` (set by the Staff) says whether its owner may change it again;
   * left out, it stays as it was. Any name they were waiting for is settled.
   */
  function rename(gameId: string, who: { email?: string; playerId?: string }, name: string, locked?: boolean) {
    const game = latest(gameId);
    const playerId = who.playerId ?? (who.email ? playerOf(gameId, who.email, game) : undefined);
    const email = who.email ?? (playerId ? emailOfPlayer(gameId, playerId) : undefined);
    const write = (tx: Tx) => {
      if (!email) return;
      const guestName = playerId ? null : name;
      tx.insert(gameNames)
        .values({ gameId, email, name: guestName, locked: locked ?? false })
        .onConflictDoUpdate({ target: [gameNames.gameId, gameNames.email], set: { name: guestName, pending: null, ...(locked === undefined ? {} : { locked }) } })
        .run();
      renameAuthor(tx, gameId, email, name);
    };
    if (playerId) command(gameId, { type: "RenamePlayer", playerId, name }, write);
    else db.transaction(write);
    if (email) {
      postsChanged(gameId);
      staffChanged(gameId); // it may have settled a name that was waiting
    }
  }

  /**
   * The name someone's Post goes up under: a Player's own; a Guest's name in this Game, which they give (or change)
   * by posting unless the Staff locked it. Under Approve names a new name waits, and they post as the old one (or
   * as "Guest") until it's approved. `settle` makes a new or changed name theirs (on earlier Posts too), once the
   * Post is going ahead. Undefined if a Guest gives no name and has none.
   */
  function nameToPostAs(gameId: string, email: string, asked: string | undefined): { author: string; settle: () => void } | undefined {
    const game = latest(gameId);
    const playerId = playerOf(gameId, email, game);
    const saved = playerId ? undefined : nameRow(gameId, email);
    const fixed = saved?.locked && saved.name ? saved.name : undefined;
    const wants = playerId || fixed ? undefined : asked;
    const held = wants !== undefined && wants !== saved?.name && needsApproval(gameId, email, game);
    const waiting = saved?.name ?? WAITING_GUEST;
    const author = playerId
      ? playerName(game, playerId)!
      : (fixed ?? (held ? waiting : (wants ?? saved?.name ?? (saved?.pending ? waiting : undefined))));
    if (!author) return undefined;
    const settle = () => {
      if (held) {
        if (wants !== saved?.pending) holdName(gameId, email, wants);
      } else if (!playerId && author !== saved?.name && author !== WAITING_GUEST) rename(gameId, { email }, author);
    };
    return { author, settle };
  }

  /**
   * Someone changes their own name in the Game (a Player's or a Guest's): refused if the Staff locked it; under
   * Approve names it waits ("held"), otherwise it's theirs at once ("renamed").
   */
  function changeMyName(gameId: string, email: string, name: string): "locked" | "held" | "renamed" {
    if (nameRow(gameId, email)?.locked) return "locked";
    if (needsApproval(gameId, email, latest(gameId))) {
      holdName(gameId, email, name);
      return "held";
    }
    rename(gameId, { email }, name);
    return "renamed";
  }

  /** Everyone signed in whom the Game knows: its Hosts, those who joined, posted, reacted or voted, or just opened it. */
  function knownPeople(gameId: string): Set<string> {
    const emails = new Set<string>();
    for (const table of [gameHosts, gameVisitors, gameNames, gamePlayers, posts, postReactions, votes] as const)
      for (const r of db.selectDistinct({ email: table.email }).from(table).where(eq(table.gameId, gameId)).all()) emails.add(r.email);
    for (const e of emails) if (e.startsWith(DEMO_ACTOR)) emails.delete(e);
    return emails;
  }

  /** The email behind a person's key in the Game's Co-hosts panel, if there's such a person. */
  const byKey = (gameId: string, key: string): string | undefined => [...knownPeople(gameId)].find((e) => personKey(gameId, e) === key);

  /** Everyone the Game knows, for the Host's Co-hosts panel: by name where there is one, never by email. */
  function panel(gameId: string, game: G, viewerEmail: string): Person[] {
    const roles = staff(gameId);
    const list = [...knownPeople(gameId)].map((who): Person => {
      const playerId = roles.get(who)?.playerId ?? playerOf(gameId, who, game) ?? null;
      const posted = db
        .select({ author: posts.author })
        .from(posts)
        .where(and(eq(posts.gameId, gameId), eq(posts.email, who)))
        .orderBy(desc(posts.createdAt))
        .get()?.author;
      return {
        key: personKey(gameId, who),
        name: (playerId && playerName(game, playerId)) || nameRow(gameId, who)?.name || posted || null,
        hint: emailHint(who),
        playerId,
        role: roles.get(who)?.role ?? null,
        you: who === viewerEmail,
      };
    });
    // By name; those with none yet go last, by their email hint.
    return list.sort((a, b) => (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) || (a.name ?? a.hint).localeCompare(b.name ?? b.hint));
  }

  /**
   * The Host switches someone's Co-host role on or off, or says which Player a Host or Co-host plays as (the Host
   * plays too, most often). The Host is always the Host, and only the Staff play as someone here.
   */
  function appoint(gameId: string, key: string, change: { cohost?: boolean | undefined; playsAs?: string | null | undefined }): PeopleRefusal | null {
    const who = byKey(gameId, key);
    if (!who) return refuse("NotFound", "Nobody like that in this Game");
    const { cohost, playsAs } = change;
    const role = roleIn(gameId, who);
    if (role === "host" && cohost === false) return refuse("Invalid", "The Host is always the Host");
    if (playsAs && !rosterIds(latest(gameId)).includes(playsAs)) return refuse("Invalid", "No such Player in this Game");
    const staffAfter = cohost ?? role !== undefined;
    if (playsAs !== undefined && !staffAfter) return refuse("Invalid", "Only a Host or Co-host plays as someone here");
    setStaff(gameId, who, { cohost, playsAs });
    staffChanged(gameId);
    return null;
  }

  /** Under Approve names: the names people asked for, waiting for the Staff, with what's shown meanwhile. */
  function pending(gameId: string, game: G): PendingName[] {
    return db
      .select()
      .from(gameNames)
      .where(and(eq(gameNames.gameId, gameId), isNotNull(gameNames.pending)))
      .all()
      .map((r) => {
        const playerId = playerOf(gameId, r.email, game) ?? null;
        const shown = playerId ? (playerName(game, playerId) ?? WAITING_PLAYER) : (r.name ?? WAITING_GUEST);
        return { key: personKey(gameId, r.email), shown, wants: r.pending!, playerId };
      });
  }

  /** The Staff approve the name someone asked for: it's theirs, everywhere. */
  function approve(gameId: string, key: string): PeopleRefusal | null {
    const row = db
      .select()
      .from(gameNames)
      .where(and(eq(gameNames.gameId, gameId), isNotNull(gameNames.pending)))
      .all()
      .find((r) => personKey(gameId, r.email) === key);
    if (!row?.pending) return refuse("NotFound", "That name isn't waiting any more");
    rename(gameId, { email: row.email }, row.pending);
    return null;
  }

  /** The Staff rename someone found by their key in the Co-hosts panel, and lock the name or not. */
  function renameByKey(gameId: string, key: string, name: string, locked?: boolean): PeopleRefusal | null {
    const who = byKey(gameId, key);
    if (!who) return refuse("NotFound", "No such person in this Game");
    rename(gameId, { email: who }, name, locked);
    return null;
  }

  return {
    panel,
    appoint,
    pending,
    approve,
    renameByKey,
    nameRow,
    nameIn,
    needsApproval,
    holdName,
    rename,
    nameToPostAs,
    changeMyName,
    roleIn,
    playerOf,
    emailOfPlayer,
    staffOf,
    staff,
    playerEmails,

    /** Makes this person the new Game's Host, in the transaction that creates it. */
    addHost: (tx: Tx, gameId: string, email: string) =>
      writing(gameId, () => tx.insert(gameHosts).values({ gameId, email, role: "host" }).run()),

    setStaff,

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
