import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backup } from "../src/backup.js";
import { createServer } from "../src/server.js";
import { capturingMailer, hostGame, post } from "./support.js";

describe("Backing up", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "elephant-backup-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("copies every Game while the app is running, into a file a new server opens as it was", async () => {
    const dbPath = join(dir, "games.db");
    const { sent, mailer } = capturingMailer();
    const live = createServer({ dbPath, mailer });
    const running = await live.listen(0);
    const { id, cookie } = await hostGame(live.app, sent);
    await live.app.request(`/api/games/${id}/commands`, post({ type: "AddPlayer", playerId: "ann", name: "Ann" }, cookie));

    const file = await backup({ dbPath, dir: join(dir, "backups"), now: new Date(Date.UTC(2026, 11, 13, 21, 30)) });
    await running.close();

    expect(file).toBe(join(dir, "backups", "elephant-2026-12-13T2130Z.db"));
    const restored = createServer({ dbPath: file, mailer });
    const res = await restored.app.request(`/api/games/${id}`);
    expect(await res.json()).toMatchObject({ id, players: [{ id: "ann", name: "Ann" }] });
    // Sign-ins come along too, so the Host is still signed in after a restore.
    expect((await restored.app.request("/api/games", { headers: { cookie } })).status).toBe(200);
  });

  it("keeps only the newest backups", async () => {
    const dbPath = join(dir, "games.db");
    createServer({ dbPath });
    const backups = join(dir, "backups");
    for (let day = 1; day <= 5; day++) {
      await backup({ dbPath, dir: backups, now: new Date(Date.UTC(2026, 11, day, 3)), keep: 3 });
    }
    writeFileSync(join(backups, "notes.txt"), "not a backup; left alone");

    await backup({ dbPath, dir: backups, now: new Date(Date.UTC(2026, 11, 6, 3)), keep: 3 });

    expect(readdirSync(backups).sort()).toEqual([
      "elephant-2026-12-04T0300Z.db",
      "elephant-2026-12-05T0300Z.db",
      "elephant-2026-12-06T0300Z.db",
      "notes.txt",
    ]);
  });
});
