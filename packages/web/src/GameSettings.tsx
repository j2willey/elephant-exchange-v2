import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { GameView, Moderation, SharedGame } from "./api.js";
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
      <Posting game={game} />
      <GameLook game={game} />
      {game.phase !== "ended" && <EndGame game={game} onEnded={accept} />}
    </div>
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

/** The Host may end the Game at any moment (the room booking may run out), but never by one stray tap. */
function EndGame({ game, onEnded }: { game: GameView; onEnded: (game: SharedGame) => void }) {
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
          End the Game
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
