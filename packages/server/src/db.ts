import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const games = sqliteTable("games", {
  id: text("id").primaryKey(),
  /** The GameSettings the Game was created with (JSON); later changes are SettingsChanged events. */
  settings: text("settings").notNull(),
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
export const signInLinks = sqliteTable("sign_in_links", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  /** When and from where it was asked for: the rate limits count these. */
  requestedAt: integer("requested_at", { mode: "timestamp_ms" }).notNull(),
  clientIp: text("client_ip").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
});

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
  (t) => [primaryKey({ columns: [t.gameId, t.email] })],
);

export function openDb(path: string) {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      settings TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS game_events (
      game_id TEXT NOT NULL REFERENCES games(id),
      seq INTEGER NOT NULL,
      event TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (game_id, seq)
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sign_in_links (
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      requested_at INTEGER NOT NULL,
      client_ip TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS sign_in_links_requested_at ON sign_in_links (requested_at);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS game_hosts (
      game_id TEXT NOT NULL REFERENCES games(id),
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('host', 'cohost')),
      PRIMARY KEY (game_id, email)
    );
  `);
  return drizzle(sqlite);
}

export type Db = ReturnType<typeof openDb>;
