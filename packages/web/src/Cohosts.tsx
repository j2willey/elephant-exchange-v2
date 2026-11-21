import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import type { GameView, Person, StaffMember } from "./api.js";
import { useApi } from "./ApiContext.js";
import { useTheme } from "./theme.js";
import { useLiveGame } from "./useLiveGame.js";

/**
 * The Host's Co-hosts panel: everyone the Game knows (signed in and joined, posted, reacted, voted or just opened it),
 * found by typing part of a name, each with a Co-host switch. Kept off the console so nobody is made a Co-host, or
 * stops being one, by a stray tap mid-party. Also says which Player each Co-host (and the Host) plays as, so their
 * consoles can mark them: when it's their turn, someone else has to enter it.
 */
export function CohostsPage() {
  const { id = "" } = useParams();
  const [game, , , staffChanges] = useLiveGame(id);
  useTheme(game && game !== "loading" ? game.theme : undefined);
  const back = (
    <Link to={`/games/${id}`} className="back">
      ← Back to the game
    </Link>
  );

  if (game === "loading") return <p className="muted">Loading…</p>;
  if (!game) return <p className="error">There's no Game at this link. Check it with your Host.</p>;
  if (game.role !== "host") {
    return (
      <div className="stack">
        {back}
        <p className="card muted">Only the Host appoints Co-hosts.</p>
      </div>
    );
  }
  return (
    <div className="stack">
      {back}
      <Panel game={game} changes={staffChanges} />
    </div>
  );
}

function Panel({ game, changes }: { game: GameView; changes: number }) {
  const api = useApi();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [find, setFind] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    let current = true;
    api.people(game.id).then(
      (list) => current && setPeople(list),
      () => current && setPeople([]),
    );
    return () => {
      current = false;
    };
    // The roster too: someone who just joined becomes a name to find.
  }, [api, game.id, changes, asked, game.players.length]);

  async function change(who: Person, what: { cohost?: boolean; playsAs?: string | null }) {
    setError(null);
    try {
      await api.setPerson(game.id, who.key, what);
    } catch {
      setError("That didn't work. Please try again.");
    }
    setAsked((n) => n + 1);
  }

  const words = find.trim().toLowerCase();
  const shown = (people ?? []).filter((p) => !words || `${p.name ?? ""} ${p.hint}`.toLowerCase().includes(words));
  // Players the Host typed in have no email, so they aren't among the people above. Found by name too, so a search
  // for one isn't a dead end: they can be made a Co-host once given an email.
  const linked = new Set((people ?? []).map((p) => p.playerId).filter((x) => x !== null));
  const typedIn = words ? game.players.filter((pl) => !linked.has(pl.id) && pl.name.toLowerCase().includes(words)) : [];
  const label = (p: Person) => (p.you ? `You${p.name ? ` (${p.name})` : ""}` : (p.name ?? p.hint));

  return (
    <section className="card stack" aria-label="Co-hosts">
      <h2>{game.name}: Co-hosts</h2>
      <p className="muted hint">
        A Co-host can do everything at the party that you can: enter opens and steals, moderate the Chat, run the vote.
        Only you add Co-hosts or delete the Game. Co-hosts must sign in, so they're found here by the name they joined
        with. Players you typed in are found too, and need an email added.
      </p>
      <label htmlFor="cohosts-find">Find someone</label>
      <input id="cohosts-find" type="search" autoComplete="off" placeholder="Start typing a name" value={find} onChange={(e) => setFind(e.target.value)} />
      {people === null ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 && typedIn.length === 0 ? (
        <p className="muted">{people.length === 0 && !words ? "Nobody has opened this Game yet." : "Nobody by that name."}</p>
      ) : shown.length === 0 ? null : (
        <ul className="people" aria-label="People in this Game">
          {shown.map((p) => (
            <li key={p.key} aria-label={label(p)} className={p.role ? "staff" : undefined}>
              <span className="person">
                <strong>{label(p)}</strong>
                {p.name && <span className="muted"> {p.hint}</span>}
                {!p.name && !p.you && <span className="muted"> (no name yet)</span>}
              </span>
              {p.role === "host" ? (
                <span className="staff-mark">👑 Host</span>
              ) : (
                <label className="switch">
                  <input type="checkbox" role="switch" checked={p.role === "cohost"} onChange={(e) => void change(p, { cohost: e.target.checked })} />
                  Co-host
                </label>
              )}
              {p.role && (
                <span className="plays-as">
                  <label htmlFor={`plays-${p.key}`}>Plays as</label>
                  <select
                    id={`plays-${p.key}`}
                    value={p.playerId ?? ""}
                    onChange={(e) => void change(p, { playsAs: e.target.value || null })}
                  >
                    <option value="">Not playing</option>
                    {game.players.map((pl) => (
                      <option key={pl.id} value={pl.id}>
                        {pl.name}
                      </option>
                    ))}
                  </select>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {typedIn.length > 0 && (
        <ul className="people" aria-label="Players you typed in">
          {typedIn.map((pl) => (
            <TypedInPlayer key={pl.id} gameId={game.id} player={pl} onAdded={() => setAsked((n) => n + 1)} />
          ))}
        </ul>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <AddByEmail gameId={game.id} onAdded={() => setAsked((n) => n + 1)} />
    </section>
  );
}

/**
 * A Player the Host typed in, found by name: they have no email, so they can't be a Co-host until given one. Adding
 * it makes that email a Co-host who plays as this Player; no email is sent, and it counts once they sign in with it.
 */
function TypedInPlayer({ gameId, player, onAdded }: { gameId: string; player: { id: string; name: string }; onAdded: () => void }) {
  const api = useApi();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const field = `typed-in-${player.id}`;

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.addCohost(gameId, email.trim(), player.id);
      onAdded();
    } catch {
      setError("That didn't work. Check the email and try again.");
    }
  }

  return (
    <li aria-label={player.name}>
      <span className="person">
        <strong>{player.name}</strong>
        <span className="muted"> a Player you typed in, who hasn't signed in</span>
      </span>
      <form className="inline" onSubmit={add}>
        <label htmlFor={field} className="visually-hidden">
          {player.name}'s email
        </label>
        <input id={field} type="email" required autoComplete="off" placeholder={`${player.name}'s email`} value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit" className="secondary">
          Make co-host
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/** For someone who hasn't opened the Game yet, such as a Co-host set up the day before. */
function AddByEmail({ gameId, onAdded }: { gameId: string; onAdded: () => void }) {
  const api = useApi();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.addCohost(gameId, email.trim());
      setEmail("");
      onAdded();
    } catch {
      setError("That didn't work. Check the email and try again.");
    }
  }

  return (
    <form className="stack" onSubmit={add}>
      <label htmlFor="cohosts-email">Not in the list? Add a Co-host by email</label>
      <div className="inline">
        <input id="cohosts-email" type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit" className="secondary">
          Add
        </button>
      </div>
      <p className="muted hint">No email is sent. Tell them to sign in at {window.location.host} with this address; the Game will be on their home screen.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * Which Players are the Host or a Co-host, for the Host's and Co-hosts' consoles (nobody else is told). Reloaded when
 * who co-hosts changes, or the roster does (a Co-host who joins as a Player).
 */
export function useStaff(game: GameView | null | "loading", changes: number): (playerId: string) => StaffMember["role"] | undefined {
  const api = useApi();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const ready = game !== null && game !== "loading";
  const id = ready ? game.id : "";
  const runs = ready && game.role !== null;
  const players = ready ? game.players.length : 0;

  useEffect(() => {
    if (!runs) return setStaff([]);
    let current = true;
    api.staff(id).then(
      (list) => current && setStaff(list),
      () => {}, // keep what we had
    );
    return () => {
      current = false;
    };
  }, [api, id, runs, changes, players]);

  return (playerId) => staff.find((s) => s.playerId === playerId)?.role;
}

/** Beside a Player's name on the consoles: they're the Host or a Co-host, so someone else enters their turn. */
export function StaffMark({ role }: { role: StaffMember["role"] | undefined }) {
  if (!role) return null;
  return (
    <span className="staff-mark" title={role === "host" ? "The Host: enter their turn for them" : "A Co-host: enter their turn for them"}>
      {role === "host" ? "👑 Host" : "🛡 Co-host"}
    </span>
  );
}
