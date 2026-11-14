import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

const NAME = /^elephant-\d{4}-\d{2}-\d{2}T\d{4}Z\.db$/;

/**
 * Copies the database into `dir` as elephant-<UTC time>.db, safely while the app is running (SQLite's
 * online backup), then deletes all but the newest `keep` backups. Returns the new backup's path.
 */
export async function backup({
  dbPath,
  dir,
  now = new Date(),
  keep = 14,
}: {
  dbPath: string;
  dir: string;
  now?: Date;
  keep?: number;
}): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().slice(0, 16).replaceAll(":", "") + "Z"; // 2026-12-13T2130Z
  const file = join(dir, `elephant-${stamp}.db`);
  const partial = `${file}.partial`; // never mistaken for a whole backup if this is cut short

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await db.backup(partial);
  } finally {
    db.close();
  }
  renameSync(partial, file);

  const backups = readdirSync(dir).filter((f) => NAME.test(f)).sort();
  for (const old of backups.slice(0, Math.max(0, backups.length - keep))) rmSync(join(dir, old));
  return file;
}

// Run directly (as scripts/backup.sh does, inside the container): back up DB_PATH into BACKUP_DIR.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const env = process.env;
  const file = await backup({
    dbPath: env["DB_PATH"] ?? "elephant.db",
    dir: env["BACKUP_DIR"] ?? "backups",
    keep: Number(env["BACKUP_KEEP"] ?? 14),
  });
  console.log(file);
}
