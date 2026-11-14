import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

const pkg = resolve(import.meta.dirname, "..");

describe("Database migrations", () => {
  it("cover every change to the tables, so no change ships without its migration", () => {
    // Generate against a copy of the migrations, so a failing run leaves the real folder untouched.
    const dir = mkdtempSync(join(tmpdir(), "elephant-migrations-"));
    try {
      cpSync(join(pkg, "drizzle"), join(dir, "drizzle"), { recursive: true });
      const config = join(dir, "drizzle.config.json");
      // drizzle-kit reads these relative to the package (it puts "./" in front of an absolute path).
      writeFileSync(config, JSON.stringify({ dialect: "sqlite", schema: "./src/db.ts", out: relative(pkg, join(dir, "drizzle")) }));
      const before = readdirSync(join(dir, "drizzle"));

      const output = execFileSync(join(pkg, "../../node_modules/.bin/drizzle-kit"), ["generate", "--config", config], {
        cwd: pkg,
        encoding: "utf8",
      });

      expect(output, "run `npm run db:generate` and commit the new migration").toContain("No schema changes");
      expect(readdirSync(join(dir, "drizzle"))).toEqual(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("upgrade a database left by any earlier version without losing its Games", async () => {
    const journal = JSON.parse(readFileSync(join(pkg, "drizzle/meta/_journal.json"), "utf8")) as { entries: unknown[] };
    for (let applied = 1; applied < journal.entries.length; applied++) {
      const dir = mkdtempSync(join(tmpdir(), "elephant-upgrade-"));
      try {
        // The migrations folder as it stood back then: only the first `applied` of them.
        cpSync(join(pkg, "drizzle"), join(dir, "drizzle"), { recursive: true });
        writeFileSync(join(dir, "drizzle/meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, applied) }));
        const file = join(dir, "old.db");
        const old = new Database(file);
        migrate(drizzle(old), { migrationsFolder: join(dir, "drizzle") });
        old.prepare("INSERT INTO games (id, settings, created_at) VALUES ('old', '{\"activeSlots\":1,\"maxSteals\":3}', 1)").run();
        old.close();

        const { app } = createServer({ dbPath: file });
        const res = await app.request("/api/games/old");

        expect(res.status, `upgrading from migration ${applied}`).toBe(200);
        expect(await res.json()).toMatchObject({ id: "old", phase: "setup", settings: { activeSlots: 1, maxSteals: 3 } });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});
