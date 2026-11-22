import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REACTIONS as SERVER_REACTIONS } from "../../server/src/schemas.js";
import { describe, expect, it } from "vitest";
import { REACTIONS } from "../src/api.js";

const SRC = join(import.meta.dirname, "../src");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));

describe("What the web app knows of the server", () => {
  it("offers every Reaction the server does, in the server's order", () => {
    expect(REACTIONS.map((r) => r.emoji)).toEqual([...SERVER_REACTIONS]);
  });

  it("comes only through src/wire.ts, and only as types, so no server code reaches the browser", () => {
    const importers = files(SRC).filter((f) => /from\s+["']@elephant\/server["']|from\s+["'][./]*\.\.\/server\//.test(readFileSync(f, "utf8")));
    expect(importers.map((f) => f.slice(SRC.length + 1))).toEqual(["wire.ts"]);
    expect(readFileSync(join(SRC, "wire.ts"), "utf8")).toMatch(/^export type \{/m);
    expect(readFileSync(join(SRC, "wire.ts"), "utf8")).not.toMatch(/^(import|export) (?!type)/m);
  });
});
