import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { StatsSummary } from "./api.js";
import { useApi } from "./ApiContext.js";
import { Insights } from "./Insights.js";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
const mins = (m: number | null) => (m === null ? "—" : m < 1 ? "under 1 min" : m < 90 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`);

/**
 * The usage statistics (ADR-0005), for the admin: how many Hosts, Organizations, Games and people, how long Games
 * run, and where people came from. Deleted Games and Organizations still count; demos, test addresses, try-outs
 * and Games excluded here don't.
 */
export function StatsPage() {
  const api = useApi();
  const [stats, setStats] = useState<StatsSummary | "loading" | "notFound" | "failed">("loading");
  const [showAll, setShowAll] = useState(false);

  const reload = useCallback(
    () =>
      api.adminStats().then(
        (s) => setStats(s),
        () => setStats("failed"),
      ),
    [api],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  if (stats === "loading") return <p className="muted">Loading…</p>;
  if (stats === "notFound") return <p>There's nothing here.</p>;
  if (stats === "failed") return <p className="error">The statistics couldn't be loaded. Please reload the page.</p>;

  const { totals } = stats;
  const games = showAll ? stats.games : stats.games.filter((g) => !g.demo && !g.test);
  const figures: [string, string | number][] = [
    ["Games played", totals.gamesPlayed],
    ["Games finished", totals.gamesFinished],
    ["Games created", totals.gamesCreated],
    ["Hosts", totals.hosts],
    ["Hosts who created a Game", totals.hostsWhoCreated],
    ["Organizations", totals.organizations],
    ["People signed in", totals.people],
    ["Players in played Games", totals.players],
    ["…on their own phones", totals.signedInPlayers],
    ["Average Game", mins(totals.averageMinutes)],
    ["…not counting breaks", mins(totals.averageActiveMinutes)],
  ];

  return (
    <div className="stack admin">
      <Link to="/admin" className="back">
        ← Admin
      </Link>
      <section className="card" aria-label="Totals">
        <h2>Stats</h2>
        <p className="muted hint">
          A Game counts once it's played: started, with at least 4 Players and 3 Picks. Its length runs from the first
          Pick to End Game. Deleted Games and Organizations still count; demos, @example.com accounts and Games you
          exclude below don't.
        </p>
        <dl className="stat-tiles">
          {figures.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Insights insights={stats.insights} />

      <section className="card">
        <h2>Where people came from</h2>
        {stats.sources.length === 0 ? (
          <p className="muted">
            Nobody yet. Add <code>?ref=</code> to the links you share, such as <code>elephantexchange.app/?ref=linkedin</code>.
          </p>
        ) : (
          <div className="table-scroll">
            <table aria-label="Sources">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Visits</th>
                  <th>Signed in</th>
                </tr>
              </thead>
              <tbody>
                {stats.sources.map((s) => (
                  <tr key={s.ref}>
                    <td>{s.ref}</td>
                    <td>{s.visits}</td>
                    <td>{s.signUps}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Hosts</h2>
        {stats.hosts.length === 0 ? (
          <p className="muted">No played Games yet.</p>
        ) : (
          <div className="table-scroll">
            <table aria-label="Hosts">
              <thead>
                <tr>
                  <th>Host</th>
                  <th>Games played</th>
                  <th>Average Game</th>
                </tr>
              </thead>
              <tbody>
                {stats.hosts.map((h, i) => (
                  <tr key={h.email ?? `gone-${i}`}>
                    <td>{h.email ?? <span className="muted">(no longer signed up)</span>}</td>
                    <td>{h.games}</td>
                    <td>{mins(h.averageMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Organizations</h2>
        {stats.organizations.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <div className="table-scroll">
            <table aria-label="Organizations">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Games played</th>
                </tr>
              </thead>
              <tbody>
                {stats.organizations.map((o, i) => (
                  <tr key={`${o.name}-${i}`}>
                    <td>
                      {o.name}
                      {o.deleted && <span className="muted"> (deleted)</span>}
                    </td>
                    <td>{o.games}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Games</h2>
        <label className="check">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show demos and test accounts too
        </label>
        <div className="table-scroll">
          <table aria-label="Games in the statistics">
            <thead>
              <tr>
                <th>Game</th>
                <th>Host</th>
                <th>Created</th>
                <th>Played</th>
                <th>Length</th>
                <th>Players</th>
                <th>Steals</th>
                <th>Counted</th>
                <th>Exclude</th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <tr key={g.id} aria-label={g.name}>
                  <td>
                    {g.name}
                    {g.deleted && <span className="muted"> (deleted)</span>}
                    {g.demo && <span className="muted"> (demo)</span>}
                  </td>
                  <td>{g.host ?? <span className="muted">—</span>}</td>
                  <td>{day(g.createdAt)}</td>
                  <td>{day(g.firstPickAt)}</td>
                  <td>{mins(g.minutes)}</td>
                  <td>{g.players}</td>
                  <td>{g.steals}</td>
                  <td>{g.counted ? "Yes" : "—"}</td>
                  <td>
                    {!g.demo && !g.test && (
                      <input
                        type="checkbox"
                        aria-label={`Exclude ${g.name} from the stats`}
                        checked={g.excluded}
                        onChange={(e) => void api.adminExcludeFromStats(g.id, e.target.checked).then(reload)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
