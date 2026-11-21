import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { ServerHealth, SystemReport } from "./api.js";
import { useApi } from "./ApiContext.js";

/** How often the page asks again while it's open. */
const REFRESH_MS = 30_000;

const bytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);
const duration = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 172_800 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 86_400)} days`);
const ago = (iso: string | null, now: Date) => (iso ? `${duration((now.getTime() - new Date(iso).getTime()) / 1000)} ago` : "never");

/**
 * For the admin: how each server is doing (docs/scale-plan.md, "Watching the servers"). One server today; with
 * more, each gets a row and the totals add them up. Asks again every 30 seconds while it's open.
 */
export function SystemPage() {
  const api = useApi();
  const [report, setReport] = useState<SystemReport | "loading" | "notFound" | "failed">("loading");

  const reload = useCallback(
    () =>
      api.adminSystem().then(
        (r) => setReport(r),
        () => setReport("failed"),
      ),
    [api],
  );
  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  if (report === "loading") return <p className="muted">Loading…</p>;
  if (report === "notFound") return <p>There's nothing here.</p>;
  if (report === "failed") return <p className="error">The servers' health couldn't be loaded. Please reload the page.</p>;

  const now = new Date(report.checkedAt);
  const { servers } = report;
  const troubled = servers.filter((s) => s.warnings.length > 0);
  const sum = (f: (s: ServerHealth) => number) => servers.filter((s) => s.up).reduce((n, s) => n + f(s), 0);

  return (
    <div className="stack admin">
      <Link to="/admin" className="back">
        ← Admin
      </Link>
      <section className="card" aria-label="System">
        <h2>System</h2>
        <p className={troubled.length ? "error" : "muted"}>
          {troubled.length === 0
            ? `All ${servers.length === 1 ? "good" : `${servers.length} servers good`}.`
            : `${troubled.length} of ${servers.length} ${servers.length === 1 ? "server needs" : "servers need"} a look.`}{" "}
          <span className="muted">Checked {now.toLocaleTimeString()}; updates every 30 seconds.</span>
        </p>
        <dl className="stat-tiles">
          {(
            [
              ["Screens connected", sum((s) => s.screens)],
              ["Games being watched", sum((s) => s.gamesWatched)],
              ["Servers up", `${servers.filter((s) => s.up).length} of ${servers.length}`],
              ["Photos", bytes(sum((s) => s.photoBytes))],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="card">
        <h3>Servers</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Server</th>
                <th>Status</th>
                <th>Screens</th>
                <th>Games watched</th>
                <th>Event loop</th>
                <th>Memory</th>
                <th>Disk free</th>
                <th>Last backup</th>
                <th>Up for</th>
                <th>Build</th>
              </tr>
            </thead>
            <tbody>
              {servers.map((s) => (
                <tr key={s.tag} aria-label={`Server ${s.tag}`}>
                  <th scope="row">{s.tag}</th>
                  <td>
                    <span className={s.warnings.length ? "error" : undefined}>{s.up ? (s.warnings.length ? "⚠️ Up" : "✅ Up") : "🛑 Down"}</span>
                    {s.warnings.map((w) => (
                      <div key={w} className="error">
                        {w}
                      </div>
                    ))}
                  </td>
                  {s.up ? (
                    <>
                      <td>
                        {s.screens}
                        {s.limits.maxScreens !== null && ` of ${s.limits.maxScreens}`}
                        <div className="muted">peak {s.peakScreens}</div>
                      </td>
                      <td>
                        {s.gamesWatched}
                        <div className="muted">{s.gamesInMemory} in memory</div>
                      </td>
                      <td>{s.lagMs === null ? "—" : `${s.lagMs} ms`}</td>
                      <td>
                        {bytes(s.memory.rssBytes)}
                        {s.memory.limitBytes !== null && ` of ${bytes(s.memory.limitBytes)}`}
                      </td>
                      <td>{s.disk ? `${bytes(s.disk.freeBytes)} of ${bytes(s.disk.totalBytes)}` : "—"}</td>
                      <td>{ago(s.lastBackupAt, now)}</td>
                      <td>{duration(s.uptimeSeconds)}</td>
                      <td>
                        <code>{s.build ?? "dev"}</code>
                      </td>
                    </>
                  ) : (
                    <td colSpan={8} className="muted">
                      No answer
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted hint">
          Warnings start early: the event loop past half its limit, screens at 80% of theirs, memory at 85%, disk under
          10% free, or no backup for 36 hours.
        </p>
      </section>
    </div>
  );
}
