import { readdirSync, readFileSync, statfsSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * How one server is doing, for the admin's System page (docs/scale-plan.md, "Watching the servers"). The page shows
 * a list of these: one server today; with more, the first would ask each of the others for theirs.
 */
export interface ServerHealth {
  /** Its SERVER_TAG: the tag at the front of the ids of the Games it holds. */
  tag: string;
  /** The web app's build it's serving (the content hash), or null outside production. */
  build: string | null;
  /** The git commit it was built from, or null outside production. */
  commit: string | null;
  /** False for a server that didn't answer (with more than one server); this server always answers for itself. */
  up: boolean;
  startedAt: string;
  uptimeSeconds: number;
  /** Screens connected right now (phones, consoles, the big screen), and the most at once since it started. */
  screens: number;
  peakScreens: number;
  /** Games with at least one screen watching, and Games kept in memory (both let go after hours unwatched). */
  gamesWatched: number;
  gamesInMemory: number;
  /** How far behind the event loop ran lately (99th percentile over 5 s, ms); null until first measured. */
  lagMs: number | null;
  /** Whether the overload guard is turning new Games away. */
  busy: boolean;
  limits: { maxScreens: number | null; maxLagMs: number | null };
  /** The process's memory, and the container's limit (null when there isn't one, as on a laptop). */
  memory: { rssBytes: number; limitBytes: number | null };
  /** The disk holding the data; null if it can't be read. */
  disk: { freeBytes: number; totalBytes: number } | null;
  photoBytes: number;
  /** When the newest backup in the backups folder was taken; null if there's none. */
  lastBackupAt: string | null;
}

/** Past these, the System page warns: early enough to act before parties notice. */
const WARN = { lagShare: 0.5, screensShare: 0.8, memoryShare: 0.85, diskFreeShare: 0.1, backupHours: 36 };

/** What's wrong with a server, in words for the System page; empty when it's healthy. */
export function healthWarnings(s: ServerHealth, now: Date): string[] {
  if (!s.up) return ["Not answering"];
  const warnings: string[] = [];
  if (s.busy) warnings.push("Turning new Games away (busy)");
  const { maxLagMs, maxScreens } = s.limits;
  if (s.lagMs !== null && maxLagMs !== null && s.lagMs > maxLagMs * WARN.lagShare) {
    warnings.push(`Event loop ${Math.round(s.lagMs)} ms behind (limit ${maxLagMs})`);
  }
  if (maxScreens !== null && s.screens >= maxScreens * WARN.screensShare) warnings.push(`${s.screens} screens (limit ${maxScreens})`);
  if (s.memory.limitBytes !== null && s.memory.rssBytes >= s.memory.limitBytes * WARN.memoryShare) {
    warnings.push(`Memory ${Math.round((100 * s.memory.rssBytes) / s.memory.limitBytes)}% of its limit`);
  }
  if (s.disk && s.disk.freeBytes < s.disk.totalBytes * WARN.diskFreeShare) {
    warnings.push(`Disk ${Math.round((100 * s.disk.freeBytes) / s.disk.totalBytes)}% free`);
  }
  if (s.lastBackupAt === null) warnings.push("No backup found");
  else {
    const hours = (now.getTime() - new Date(s.lastBackupAt).getTime()) / 3_600_000;
    if (hours > WARN.backupHours) warnings.push(`Last backup ${Math.round(hours)} hours ago`);
  }
  return warnings;
}

/** The container's memory limit (cgroup v2, as in Docker), or null without one. */
export function memoryLimit(file = "/sys/fs/cgroup/memory.max"): number | null {
  try {
    const text = readFileSync(file, "utf8").trim();
    const n = Number(text);
    return text === "max" || !Number.isFinite(n) ? null : n;
  } catch {
    return null;
  }
}

/** Free and total space on the disk holding this folder; null if it can't be read. */
export function diskOf(dir: string): ServerHealth["disk"] {
  try {
    const fs = statfsSync(dir);
    return { freeBytes: fs.bavail * fs.bsize, totalBytes: fs.blocks * fs.bsize };
  } catch {
    return null;
  }
}

/** When the newest backup (backup.ts's elephant-*.db) in the folder was written; null if there's none. */
export function lastBackupAt(dir: string | undefined): string | null {
  if (!dir) return null;
  try {
    const times = readdirSync(dir)
      .filter((f) => /^elephant-.*\.db$/.test(f))
      .map((f) => statSync(join(dir, f)).mtimeMs);
    return times.length ? new Date(Math.max(...times)).toISOString() : null;
  } catch {
    return null;
  }
}
