import { join } from "node:path";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const games = sqliteTable("games", {
  id: text("id").primaryKey(),
  /** What the Host calls it, such as "OA Holiday Party". */
  name: text("name").notNull().default("Gift exchange"),
  /** Who adds Players: only the Host and Co-hosts ("host"), or people themselves from their phones too ("self"). */
  rosterMode: text("roster_mode", { enum: ["host", "self"] }).notNull().default("host"),
  /** The Game's rule for Posts: "open" (they appear at once), "approval" (each waits for a Host) or "paused" (no posting). */
  moderation: text("moderation", { enum: ["open", "approval", "paused"] }).notNull().default("open"),
  /** How long each Turn's countdown runs, as a guide for the Host; 0 shows no timer. Nobody is ever skipped by it. */
  turnSeconds: integer("turn_seconds").notNull().default(60),
  /** The Worst Gift Vote: "none" (not opened yet), "open" or "closed" (results revealed). */
  voteStatus: text("vote_status", { enum: ["none", "open", "closed"] }).notNull().default("none"),
  /** What the big screen shows while the vote is open: "live" counts, "hidden" ones, or the "parade" of Gifts. */
  voteDisplay: text("vote_display", { enum: ["live", "hidden", "parade"] }).notNull().default("live"),
  /** The Gift that won once the vote closed (null if nobody voted). */
  voteWinner: text("vote_winner"),
  /** The Organization whose Theme the Game shows, if the Host picked one. */
  orgId: text("org_id").references(() => organizations.id),
  /**
   * The Game's own Theme, overriding its Organization's part by part; null parts fall back to it. Colors are
   * "#rrggbb"; logo and background are a version for the stored image (it changes with each upload).
   */
  themeColor: text("theme_color"),
  themePage: text("theme_page"),
  themeLogo: text("theme_logo"),
  themeBackground: text("theme_background"),
  /** The GameSettings the Game was created with (JSON); later changes are SettingsChanged events. */
  settings: text("settings").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  check("games_roster_mode", sql`${t.rosterMode} IN ('host', 'self')`),
  check("games_moderation", sql`${t.moderation} IN ('open', 'approval', 'paused')`),
  check("games_vote_status", sql`${t.voteStatus} IN ('none', 'open', 'closed')`),
  check("games_vote_display", sql`${t.voteDisplay} IN ('live', 'hidden', 'parade')`),
]);

/** A group whose exchanges share a Theme. Only its Organizer (who created it) can change it. */
export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  organizerEmail: text("organizer_email").notNull(),
  /** The Theme, each part optional: colors as "#rrggbb", images as a version for the stored file. */
  color: text("color"),
  page: text("page"),
  logo: text("logo"),
  background: text("background"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** The log of each Game (ADR-0001): every event, in order. The Game's state is rebuilt from it. */
export const gameEvents = sqliteTable(
  "game_events",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.id),
    seq: integer("seq").notNull(),
    event: text("event").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.seq] })],
);

/** People who have signed in at least once. */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Emailed sign-in links. Only a hash of each token is kept, so a leaked database can't sign anyone in. */
export const signInLinks = sqliteTable(
  "sign_in_links",
  {
    tokenHash: text("token_hash").primaryKey(),
    email: text("email").notNull(),
    /** When and from where it was asked for: the rate limits count these. */
    requestedAt: integer("requested_at", { mode: "timestamp_ms" }).notNull(),
    clientIp: text("client_ip").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("sign_in_links_requested_at").on(t.requestedAt)],
);

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

/** Who runs each Game. By email, so a Co-host can be appointed before they have ever signed in. */
export const gameHosts = sqliteTable(
  "game_hosts",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.id),
    email: text("email").notNull(),
    role: text("role", { enum: ["host", "cohost"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.email] }), check("game_hosts_role", sql`${t.role} IN ('host', 'cohost')`)],
);

/**
 * Players who signed up themselves, and which person each one is: only that person may post or vote as them.
 * One Player per person per Game. Players the Host entered have no row here.
 */
export const gamePlayers = sqliteTable(
  "game_players",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.id),
    playerId: text("player_id").notNull(),
    email: text("email").notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.playerId] }), uniqueIndex("game_players_person").on(t.gameId, t.email)],
);

/**
 * When each Player who's up now was called up (or their timer last reset), for the turn timer. Kept beside the
 * log rather than in it: the timer is only a guide and changes nothing in the Game.
 */
export const turnClocks = sqliteTable(
  "turn_clocks",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.id),
    playerId: text("player_id").notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.playerId] })],
);

/**
 * What people share during a Game. `email` says whose it is (they can always see their own) and is never shown;
 * `author` is the name everyone sees. A Pending or Hidden Post is seen only by its poster and the Hosts.
 */
export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id),
    email: text("email").notNull(),
    author: text("author").notNull(),
    /** The Gift it's about, if the poster said; it then shows under that Gift as well as in the Feed. */
    giftId: text("gift_id"),
    /** Empty when the Post is just a Photo. */
    text: text("text").notNull(),
    /** A Post's Photo is stored as a file (see photos.ts); these are its size, and null when there's none. */
    photoWidth: integer("photo_width"),
    photoHeight: integer("photo_height"),
    status: text("status", { enum: ["visible", "pending", "hidden"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("posts_game").on(t.gameId, t.createdAt), check("posts_status", sql`${t.status} IN ('visible', 'pending', 'hidden')`)],
);

/** Each person's vote in a Game's Worst Gift Vote: one per person, moved by replacing it. */
export const votes = sqliteTable(
  "votes",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.id),
    email: text("email").notNull(),
    giftId: text("gift_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.email] })],
);

/** Opens the database, bringing its tables up to date with any migrations it hasn't had yet. */
export function openDb(path: string) {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite);
  // Migrations generated by drizzle-kit from the tables above (`npm run db:generate`). Worked out here, not when
  // this file loads: drizzle-kit loads it without import.meta.dirname. And a plain path, not
  // `new URL(..., import.meta.url)`, which Vite rewrites as a browser asset in the web tests.
  //
  // Foreign keys stay off while migrating. Some migrations rebuild a table (copy, drop, rename); dropping
  // `games` while other tables point at it fails with them on, and the PRAGMA drizzle-kit writes into those
  // migrations to turn them off does nothing inside the transaction each migration runs in. This is SQLite's
  // own procedure for changing a table: check every reference still holds afterwards, then turn them on.
  sqlite.pragma("foreign_keys = OFF");
  migrate(db, { migrationsFolder: join(import.meta.dirname, "../drizzle") });
  const broken = sqlite.pragma("foreign_key_check") as unknown[];
  if (broken.length > 0) throw new Error(`Migrating left ${broken.length} broken references: ${JSON.stringify(broken.slice(0, 5))}`);
  sqlite.pragma("foreign_keys = ON");
  return db;
}

export type Db = ReturnType<typeof openDb>;
/** What a transaction's callback is handed. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
