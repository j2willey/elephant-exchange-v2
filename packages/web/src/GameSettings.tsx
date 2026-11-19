import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { GameView, Moderation, RosterMode, SharedGame } from "./api.js";
import { useApi } from "./ApiContext.js";
import { GameLook } from "./GameLook.js";
import { useTheme } from "./theme.js";
import { useLiveGame } from "./useLiveGame.js";

/**
 * Everything a Host sets up once rather than taps all evening: posting, the Photos album, the Game's look, and ending
 * the Game. Kept off the Host's console so the console stays the board they run the party from.
 */
export function GameSettings() {
  const { id = "" } = useParams();
  const [game, accept] = useLiveGame(id);
  useTheme(game && game !== "loading" ? game.theme : undefined);
  const back = (
    <Link to={`/games/${id}`} className="back">
      ← Back to the game
    </Link>
  );

  if (game === "loading") return <p className="muted">Loading…</p>;
  if (!game) return <p className="error">There's no Game at this link. Check it with your Host.</p>;
  if (game.role === null) {
    return (
      <div className="stack">
        {back}
        <p className="card muted">Only the Host and Co-hosts can change this Game's settings.</p>
      </div>
    );
  }

  return (
    <div className="stack">
      {back}
      <section className="card">
        <h2>{game.name}: settings</h2>
      </section>
      <GameOptions game={game} onSaved={accept} />
      <Posting game={game} />
      <GameLook game={game} />
      <Cohosts game={game} />
      {game.phase !== "ended" && <EndGame game={game} onEnded={accept} />}
    </div>
  );
}

/**
 * The Game's name and rules, as set when it was created, changed here at any time (even mid-Game: a slow party
 * can go to 2 at a time). Only what changed is sent.
 */
function GameOptions({ game, onSaved }: { game: GameView; onSaved: (game: SharedGame) => void }) {
  const api = useApi();
  const [name, setName] = useState(game.name);
  const [slots, setSlots] = useState(String(game.settings.activeSlots));
  const [steals, setSteals] = useState(String(game.settings.maxSteals));
  const [turnSeconds, setTurnSeconds] = useState(String(game.clock.turnSeconds));
  const [rosterMode, setRosterMode] = useState<RosterMode>(game.rosterMode);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | string>("idle");

  async function save(e: FormEvent) {
    e.preventDefault();
    setStatus("saving");
    const rules = {
      ...(Number(slots) !== game.settings.activeSlots ? { activeSlots: Number(slots) } : {}),
      ...(Number(steals) !== game.settings.maxSteals ? { maxSteals: Number(steals) } : {}),
    };
    if (Object.keys(rules).length > 0) {
      const result = await api.command(game.id, { type: "ChangeSettings", settings: rules });
      if (!result.ok) return setStatus(result.message.endsWith(".") ? result.message : `${result.message}.`);
      onSaved(result.game);
    }
    const options = {
      ...(name.trim() !== game.name ? { name: name.trim() } : {}),
      ...(Number(turnSeconds) !== game.clock.turnSeconds ? { turnSeconds: Number(turnSeconds) } : {}),
      ...(rosterMode !== game.rosterMode ? { rosterMode } : {}),
    };
    if (Object.keys(options).length > 0) {
      const saved = await api.setGameOptions(game.id, options);
      if (!saved) return setStatus("That didn't save. Please try again.");
      onSaved(saved);
    }
    setStatus("saved");
  }

  return (
    <section className="card" aria-label="Game options">
      <form className="stack" onSubmit={save}>
        <h2>Game options</h2>
        <label htmlFor="opt-name">Name of the Game</label>
        <input id="opt-name" required maxLength={100} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="opt-slots">Players taking a turn at once</label>
        <input id="opt-slots" type="number" inputMode="numeric" min={1} max={10} required value={slots} onChange={(e) => setSlots(e.target.value)} />
        <label htmlFor="opt-steals">Steals before a Gift is Frozen</label>
        <input id="opt-steals" type="number" inputMode="numeric" min={0} max={20} required value={steals} onChange={(e) => setSteals(e.target.value)} />
        <label htmlFor="opt-seconds">Seconds per turn</label>
        <input
          id="opt-seconds"
          type="number"
          inputMode="numeric"
          min={0}
          max={600}
          required
          aria-describedby="opt-seconds-hint"
          value={turnSeconds}
          onChange={(e) => setTurnSeconds(e.target.value)}
        />
        <p id="opt-seconds-hint" className="muted hint">
          A countdown to keep things moving. Nobody is skipped when it runs out. 0 for none.
        </p>
        <fieldset className="choices">
          <legend>Who adds the Players?</legend>
          <label>
            <input type="radio" name="opt-roster" checked={rosterMode === "host"} onChange={() => setRosterMode("host")} />
            I'll enter them
          </label>
          <label>
            <input type="radio" name="opt-roster" checked={rosterMode === "self"} onChange={() => setRosterMode("self")} />
            Players sign up on their phones
          </label>
        </fieldset>
        {status !== "idle" && status !== "saving" && (
          <p className={status === "saved" ? "muted" : "error"} role={status === "saved" ? "status" : "alert"}>
            {status === "saved" ? "Saved." : status}
          </p>
        )}
        <button type="submit" disabled={status === "saving"}>
          Save options
        </button>
      </form>
    </section>
  );
}

const modes: { mode: Moderation; label: string }[] = [
  { mode: "open", label: "Open: Posts appear at once" },
  { mode: "approval", label: "Approval: each Post waits for you to approve it" },
  { mode: "paused", label: "Paused: nobody can post" },
];

function Posting({ game }: { game: GameView }) {
  const api = useApi();
  return (
    <section className="card" aria-label="Feed settings">
      <h2>Feed</h2>
      <fieldset className="choices">
        <legend>Posting</legend>
        {modes.map(({ mode, label }) => (
          <label key={mode}>
            <input type="radio" name="moderation" checked={game.moderation === mode} onChange={() => void api.setModeration(game.id, mode)} />
            {label}
          </label>
        ))}
      </fieldset>
      <p className="album">
        <a href={`/api/games/${encodeURIComponent(game.id)}/album.zip`} download>
          Download all the Photos
        </a>{" "}
        <span className="muted hint">(a .zip). Photos are deleted 60 days after the Game's last move, so keep a copy.</span>
      </p>
    </section>
  );
}

/**
 * Co-hosts can do everything the Host can at the party (run turns, the vote, the big screen, settings), except
 * appoint Co-hosts or delete the Game. The Host adds them by email; nothing is sent: they sign in with that email
 * and find the Game on their home screen.
 */
function Cohosts({ game }: { game: GameView }) {
  const api = useApi();
  const [list, setList] = useState<string[] | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isHost = game.role === "host";

  useEffect(() => {
    let current = true;
    api.cohosts(game.id).then(
      (l) => current && setList(l),
      () => current && setList([]),
    );
    return () => {
      current = false;
    };
  }, [api, game.id]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.addCohost(game.id, email.trim());
      setList(await api.cohosts(game.id));
      setEmail("");
    } catch {
      setError("That didn't work. Check the email and try again.");
    }
  }

  async function remove(who: string) {
    setError(null);
    try {
      await api.removeCohost(game.id, who);
      setList(await api.cohosts(game.id));
    } catch {
      setError("That didn't work. Please try again.");
    }
  }

  return (
    <section className="card stack" aria-label="Co-hosts">
      <h2>Co-hosts</h2>
      <p className="muted hint">
        Someone to run the party with you, or instead of you if you'd like to play. A Co-host can do everything at the
        party that you can, but can't add Co-hosts or delete the Game.
      </p>
      {isHost && <Link to={`/games/${game.id}/cohosts`}>🛡 Find someone in the Game to make a Co-host</Link>}
      {list === null ? (
        <p className="muted">Loading…</p>
      ) : list.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <ul className="cohost-list" aria-label="Co-hosts of this Game">
          {list.map((who) => (
            <li key={who}>
              <span>{who}</span>
              {isHost && (
                <button type="button" className="link danger" aria-label={`Remove ${who}`} onClick={() => void remove(who)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {isHost && (
        <form className="stack" onSubmit={add}>
          <label htmlFor="cohost-email">Add a Co-host by email</label>
          <div className="inline">
            <input
              id="cohost-email"
              type="email"
              required
              autoComplete="off"
              aria-describedby="cohost-hint"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit" className="secondary">
              Add
            </button>
          </div>
          <p id="cohost-hint" className="muted hint">
            No email is sent. Tell them to sign in at {window.location.host} with this address; the Game will be on their
            home screen.
          </p>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** The Host may end the Game at any moment (the room booking may run out), but never by one stray tap. */
export function EndGame({ game, onEnded, label = "End the Game" }: { game: GameView; onEnded: (game: SharedGame) => void; label?: string }) {
  const api = useApi();
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function end() {
    const result = await api.command(game.id, { type: "EndGame" });
    if (result.ok) {
      onEnded(result.game);
      navigate(`/games/${game.id}`); // where the Worst Gift Vote is
    } else {
      setError(result.message);
    }
  }

  return (
    <section className="card">
      {!asking ? (
        <button className="link danger" onClick={() => setAsking(true)}>
          {label}
        </button>
      ) : (
        <>
          <p>End the Game now? Everyone keeps the Gift they're holding, and nobody else gets a turn.</p>
          <div className="inline">
            <button className="danger-solid" onClick={() => void end()}>
              Yes, end it now
            </button>
            <button className="secondary" onClick={() => setAsking(false)}>
              Keep playing
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
