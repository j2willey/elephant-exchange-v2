import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { AdminGame, AdminPerson } from "./api.js";
import { useApi } from "./ApiContext.js";

/** The smoke test's accounts: an address nobody can really have. */
const isTestAccount = (email: string) => email.toLowerCase().endsWith("@example.com");

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
const phaseWords = { setup: "Not started", playing: "In progress", finalRound: "Final Round", ended: "Finished" } as const;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * For the app's admins (ADMIN_EMAILS) only: who has signed in and what they've made, every Game, and deleting a
 * Game or the smoke test's leftovers. To anyone else it's an empty page.
 */
export function AdminPage() {
  const api = useApi();
  const [people, setPeople] = useState<AdminPerson[] | "loading" | "notFound">("loading");
  const [games, setGames] = useState<AdminGame[]>([]);
  const [showTests, setShowTests] = useState(false);
  const [deleting, setDeleting] = useState<AdminGame | "test data" | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [p, g] = await Promise.all([api.adminPeople(), api.adminGames()]);
    setPeople(p);
    setGames(g === "notFound" ? [] : g);
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (people === "loading") return <p className="muted">Loading…</p>;
  if (people === "notFound") {
    return (
      <section className="card">
        <p>There's nothing here.</p>
        <Link to="/">Back to your games</Link>
      </section>
    );
  }

  const shownPeople = showTests ? people : people.filter((p) => !isTestAccount(p.email));
  const shownGames = showTests ? games : games.filter((g) => !isTestAccount(g.host));
  const okToAsk = people.filter((p) => p.feedbackOk && !isTestAccount(p.email));

  async function confirmDelete() {
    if (deleting === "test data") {
      const result = await api.adminDeleteTestData();
      if (result) {
        setDone(
          `Deleted ${plural(result.people, "person", "people")}, ${plural(result.games, "game")} and ${plural(result.organizations, "organization")}.`,
        );
      }
    } else if (deleting) {
      if (await api.adminDeleteGame(deleting.id)) setDone(`Deleted ${deleting.name}.`);
    }
    setDeleting(null);
    await reload();
  }

  return (
    <div className="stack admin">
      <Link to="/" className="back">
        ← Back to your games
      </Link>
      <section className="card">
        <h2>Admin</h2>
        <p>
          <Link to="/admin/stats">📊 Stats</Link> · <Link to="/admin/feedback">💬 Feedback</Link>
        </p>
        <p className="muted">
          {plural(people.filter((p) => !isTestAccount(p.email)).length, "person", "people")} signed in ·{" "}
          {plural(games.filter((g) => !isTestAccount(g.host)).length, "game")} · {okToAsk.length} OK to ask for feedback
        </p>
        <label className="check">
          <input type="checkbox" checked={showTests} onChange={(e) => setShowTests(e.target.checked)} />
          Show test accounts (@example.com)
        </label>
        {done && (
          <p role="status" className="muted">
            {done}
          </p>
        )}
      </section>

      {deleting && (
        <section className="card" aria-label="Confirm">
          <p>
            {deleting === "test data"
              ? "Delete every @example.com account, with the Games they host and the Organizations they run?"
              : `Delete ${deleting.name} (${deleting.host}), with its Players, Posts, Photos and votes?`}{" "}
            This can't be undone, except from a backup.
          </p>
          <div className="inline">
            <button className="danger-solid" onClick={() => void confirmDelete()}>
              {deleting === "test data" ? "Yes, delete test data" : `Yes, delete ${deleting.name}`}
            </button>
            <button className="secondary" onClick={() => setDeleting(null)}>
              Keep it
            </button>
          </div>
        </section>
      )}

      <section className="card">
        <h2>People</h2>
        {okToAsk.length > 0 && (
          <p className="muted hint">
            OK to email for feedback: <span className="select-all">{okToAsk.map((p) => p.email).join(", ")}</span>
          </p>
        )}
        <div className="table-scroll">
          <table aria-label="People">
            <thead>
              <tr>
                <th>Email</th>
                <th>First seen</th>
                <th>Last sign-in</th>
                <th>Games</th>
                <th>Organizations</th>
                <th>Feedback OK</th>
                <th>Read tip note</th>
              </tr>
            </thead>
            <tbody>
              {shownPeople.map((p) => (
                <tr key={p.email}>
                  <td>{p.email}</td>
                  <td>{day(p.firstSeen)}</td>
                  <td>{day(p.lastSignIn)}</td>
                  <td>{p.demoGames ? `${p.games} + ${p.demoGames} demo` : p.games}</td>
                  <td>{p.organizations.join(", ") || "—"}</td>
                  <td>{p.feedbackOk ? "Yes" : "—"}</td>
                  <td>{p.tipNoteRead ? "Yes" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Games</h2>
        <div className="table-scroll">
          <table aria-label="Games">
            <thead>
              <tr>
                <th>Game</th>
                <th>Host</th>
                <th>Created</th>
                <th>Players</th>
                <th>State</th>
                <th>
                  <span className="visually-hidden">Delete</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shownGames.map((g) => (
                <tr key={g.id}>
                  <td>
                    <Link to={`/games/${g.id}`}>{g.name}</Link>
                    {g.demo && <span className="badge">Demo</span>}
                  </td>
                  <td>{g.host}</td>
                  <td>{day(g.createdAt)}</td>
                  <td>{g.players}</td>
                  <td>{phaseWords[g.phase]}</td>
                  <td>
                    <button className="link danger" aria-label={`Delete ${g.name}`} onClick={() => setDeleting(g)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="secondary" onClick={() => setDeleting("test data")}>
          Delete test data
        </button>
      </section>
    </div>
  );
}
