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
  `);
  return drizzle(sqlite);
}

export type Db = ReturnType<typeof openDb>;
