import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { io } from "socket.io-client";
import { createServer } from "../src/server.js";
import { healthWarnings, type ServerHealth } from "../src/system.js";
import { capturingMailer, post, signIn } from "./support.js";

// The admin's System page: how each server is doing (docs/scale-plan.md, "Watching the servers"). One server for
// now, reported as a list so more can join it later.
describe("The admin's view of the servers", () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) await fn();
  });

  async function started(options: { backupsDir?: string } = {}) {
    const { sent, mailer } = capturingMailer();
    const server = createServer({
      dbPath: ":memory:",
      mailer,
      adminEmails: ["boss@example.org"],
      overload: { maxScreens: 500, maxLagMs: 300 },
      build: "abc123",
      commit: "5235227f0e8b1c2d3a4f5e6d7c8b9a0f1e2d3c4b",
      ...options,
    });
    const { port, close } = await server.listen(0);
    cleanups.push(close);
    const base = `http://localhost:${port}`;
    const admin = await signIn(server.app, sent, "boss@example.org");
    const host = await signIn(server.app, sent, "host@example.com");
    const system = async (cookie = admin) => fetch(`${base}/api/admin/system`, { headers: { cookie } });
    const report = async () => ((await (await system()).json()) as { servers: ServerHealth[] }).servers;
    const newGame = async () =>
      ((await (await fetch(`${base}/api/games`, post({ settings: { activeSlots: 1, maxSteals: 3 } }, host))).json()) as { id: string }).id;
    const watch = async (id: string) => {
      const screen = io(base, { query: { game: id }, transports: ["websocket"], reconnection: false });
      cleanups.push(() => void screen.close());
      await new Promise((done) => screen.once("game", done));
    };
    return { system, report, newGame, watch, host };
  }

  it("is only for admins", async () => {
    const { system, host } = await started();

    expect((await system(host)).status).toBe(404);
  });

  it("reports this server: its tag, build, limits and whether it's up", async () => {
    const { report } = await started();

    const [me, ...others] = await report();

    expect(others).toEqual([]);
    expect(me).toMatchObject({ tag: "a", build: "abc123", commit: "5235227f0e8b1c2d3a4f5e6d7c8b9a0f1e2d3c4b", up: true, busy: false, limits: { maxScreens: 500, maxLagMs: 300 } });
    expect(me!.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(me!.memory.rssBytes).toBeGreaterThan(0);
    expect(me!.disk?.freeBytes).toBeGreaterThan(0);
  });

  it("counts the screens watching and the Games they watch", async () => {
    const { report, newGame, watch } = await started();
    const party = await newGame();
    await newGame(); // made, but nobody's watching it
    await watch(party);
    await watch(party);

    const [me] = await report();

    expect(me).toMatchObject({ screens: 2, peakScreens: 2, gamesWatched: 1 });
    expect(me!.gamesInMemory).toBeGreaterThanOrEqual(1);
  });

  it("says when the last backup was taken, and warns when there's none", async () => {
    const backupsDir = mkdtempSync(join(tmpdir(), "elephant-backups-"));
    const { report } = await started({ backupsDir });
    expect((await report())[0]!.lastBackupAt).toBeNull();

    const file = join(backupsDir, "elephant-20261121-031500.db");
    writeFileSync(file, "");
    const at = new Date("2026-11-21T03:15:00Z");
    utimesSync(file, at, at);

    expect((await report())[0]!.lastBackupAt).toBe(at.toISOString());
  });
});

describe("What counts as a warning", () => {
  const now = new Date("2026-11-21T12:00:00Z");
  const healthy: ServerHealth = {
    tag: "a",
    build: "abc123",
    commit: null,
    up: true,
    startedAt: "2026-11-20T12:00:00Z",
    uptimeSeconds: 86_400,
    screens: 40,
    peakScreens: 90,
    gamesWatched: 3,
    gamesInMemory: 5,
    lagMs: 12,
    busy: false,
    limits: { maxScreens: 6000, maxLagMs: 300 },
    memory: { rssBytes: 150e6, limitBytes: 384 * 2 ** 20 },
    disk: { freeBytes: 20e9, totalBytes: 25e9 },
    photoBytes: 1e8,
    lastBackupAt: "2026-11-21T03:15:00Z",
  };

  it("finds none on a healthy server", () => {
    expect(healthWarnings(healthy, now)).toEqual([]);
  });

  it("names each thing that's wrong", () => {
    const sick: ServerHealth = {
      ...healthy,
      busy: true,
      lagMs: 200,
      screens: 5000,
      memory: { rssBytes: 360 * 2 ** 20, limitBytes: 384 * 2 ** 20 },
      disk: { freeBytes: 1e9, totalBytes: 25e9 },
      lastBackupAt: "2026-11-19T03:15:00Z",
    };

    expect(healthWarnings(sick, now)).toEqual([
      "Turning new Games away (busy)",
      "Event loop 200 ms behind (limit 300)",
      "5000 screens (limit 6000)",
      "Memory 94% of its limit",
      "Disk 4% free",
      "Last backup 57 hours ago",
    ]);
  });

  it("says a server that didn't answer is down", () => {
    expect(healthWarnings({ ...healthy, up: false }, now)).toEqual(["Not answering"]);
  });

  it("warns when there's never been a backup", () => {
    expect(healthWarnings({ ...healthy, lastBackupAt: null }, now)).toEqual(["No backup found"]);
  });
});
