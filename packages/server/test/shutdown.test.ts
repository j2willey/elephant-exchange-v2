import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, hostGame } from "./support.js";

describe("Stopping the server", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "elephant-stop-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("leaves the database whole in its one file, so a copy of that file is a complete backup", async () => {
    const dbPath = join(dir, "games.db");
    const { sent, mailer } = capturingMailer();
    const server = createServer({ dbPath, mailer });
    const running = await server.listen(0);
    await hostGame(server.app, sent);

    await running.close();

    // While running, SQLite keeps recent changes in a side file (-wal); closing folds them into the database.
    const wal = `${dbPath}-wal`;
    expect(!existsSync(wal) || statSync(wal).size === 0).toBe(true);
    const { app } = createServer({ dbPath });
    expect((await app.request("/api/games")).status).toBe(401); // opens fine
  });

  it("stops answering once closed", async () => {
    const server = createServer({ dbPath: join(dir, "games.db") });
    const { port, close } = await server.listen(0);
    expect((await fetch(`http://localhost:${port}/api/session`)).status).toBe(401);

    await close();

    await expect(fetch(`http://localhost:${port}/api/session`)).rejects.toThrow();
  });
});
