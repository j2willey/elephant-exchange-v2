import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import type { Command } from "@elephant/rules";
import type { GameView } from "./api.js";
import { useApi } from "./ApiContext.js";

export function GamePage() {
  const api = useApi();
  const { id = "" } = useParams();
  const [game, setGame] = useState<GameView | null | "loading">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api.game(id).then((g) => current && setGame(g ?? null));
    return () => {
      current = false;
    };
  }, [api, id]);

  if (game === "loading") return <p className="muted">Loading…</p>;
  if (!game) return <p className="error">There's no Game at this link. Check it with your Host.</p>;

  const runs = game.role !== null;
  const nameOf = (playerId: string) => game.players.find((p) => p.id === playerId)?.name ?? "?";

  async function send(command: Command) {
    if (game === "loading" || !game) return;
    const result = await api.command(game.id, command);
    if (result.ok) {
      setGame({ ...result.game, role: game.role });
      setError(null);
    } else {
      setError(result.message);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <Settings game={game} />
        <Link to={`/games/${game.id}`}>Link to this game</Link>
      </section>

      {game.phase !== "setup" && (
        <section className="card" aria-live="polite">
          <p>
            Up now: <strong>{game.active.map(nameOf).join(", ") || "nobody"}</strong>
          </p>
          <p>
            On deck: <strong>{game.onDeck.map(nameOf).join(", ") || "nobody"}</strong>
          </p>
        </section>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="card">
        <h2>Players</h2>
        {game.players.length === 0 ? (
          <p className="muted">No players yet.</p>
        ) : (
          <ol className="roster" aria-label="Players">
            {game.players.map((p) => (
              <li key={p.id}>
                <span data-name>{p.name}</span>
                {runs && game.phase === "setup" && (
                  <button className="link" aria-label={`Remove ${p.name}`} onClick={() => send({ type: "RemovePlayer", playerId: p.id })}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
        {runs && game.phase !== "ended" && <AddPlayer onAdd={(name) => send({ type: "AddPlayer", playerId: crypto.randomUUID(), name })} />}
        {runs && game.phase === "setup" && (
          <button disabled={game.players.length < 2} onClick={() => send({ type: "StartGame" })}>
            Start game
          </button>
        )}
      </section>
    </div>
  );
}

function Settings({ game }: { game: GameView }) {
  const { activeSlots, maxSteals } = game.settings;
  return (
    <p className="muted">
      {activeSlots === 1 ? "1 player takes a turn at once" : `${activeSlots} players take a turn at once`} ·{" "}
      {maxSteals === 0 ? "no steals" : `Gifts are frozen after ${maxSteals} ${maxSteals === 1 ? "steal" : "steals"}`}
    </p>
  );
}

/** Quick entry: the box clears and keeps focus, so the Host can type the next name straight away. */
function AddPlayer({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setName("");
    input.current?.focus();
    await onAdd(trimmed);
  }

  return (
    <form className="inline" onSubmit={submit}>
      <label htmlFor="player-name" className="visually-hidden">
        Player's name
      </label>
      <input
        id="player-name"
        ref={input}
        placeholder="Player's name"
        autoComplete="off"
        autoCapitalize="words"
        maxLength={100}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" disabled={!name.trim()}>
        Add player
      </button>
    </form>
  );
}
