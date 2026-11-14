import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

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
});
