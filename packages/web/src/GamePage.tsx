import { useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import type { Command } from "@elephant/rules";
import type { CommandResult, GameView } from "./api.js";
import { useApi } from "./ApiContext.js";
import { useLiveGame } from "./useLiveGame.js";

export function GamePage() {
  const api = useApi();
  const { id = "" } = useParams();
  const [game, accept] = useLiveGame(id);
  const [error, setError] = useState<string | null>(null);

  if (game === "loading") return <p className="muted">Loading…</p>;
  if (!game) return <p className="error">There's no Game at this link. Check it with your Host.</p>;

  const runs = game.role !== null;
  const nameOf = (playerId: string) => game.players.find((p) => p.id === playerId)?.name ?? "?";

  async function send(command: Command) {
    if (game === "loading" || !game) return;
    const result = await api.command(game.id, command);
    if (result.ok) {
      accept(result.game);
      setError(null);
    } else {
      setError(plainWords(result));
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <Settings game={game} />
        <Link to={`/games/${game.id}`}>Link to this game</Link>
        <Link to={`/games/${game.id}/screen`}>Open the big screen</Link>
      </section>

      {game.phase !== "setup" && (
        <section className="card" aria-live="polite">
          <p>
            Up now: <strong>{game.active.map(nameOf).join(", ") || "nobody"}</strong>
          </p>
          <p>
            On deck: <strong>{game.onDeck.map(nameOf).join(", ") || "nobody"}</strong>
          </p>
          {runs && (
            <button className="secondary" onClick={() => send({ type: "Undo" })}>
              Undo last pick
            </button>
          )}
        </section>
      )}

      {runs && game.phase === "playing" && game.active.map((playerId) => <Turn key={playerId} game={game} playerId={playerId} send={send} />)}

      {game.gifts.length > 0 && <Gifts game={game} />}

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

/** The rules' own messages are already plain; a couple read better reworded for a Host mid-party. */
function plainWords(result: Extract<CommandResult, { ok: false }>): string {
  switch (result.code) {
    case "NoTakeBacks":
      return "No take-backs: a Player can't steal back the Gift that was just taken from them.";
    case "GiftNotOpened":
      return "That Gift hasn't been opened yet.";
    default:
      return result.message.endsWith(".") ? result.message : `${result.message}.`;
  }
}

/** One active Player's Turn: open a Gift, steal one, or skip them. */
function Turn({ game, playerId, send }: { game: GameView; playerId: string; send: (c: Command) => Promise<void> }) {
  const name = game.players.find((p) => p.id === playerId)?.name ?? "?";
  const [gift, setGift] = useState("");
  const holderName = (id: string | null) => game.players.find((p) => p.id === id)?.name ?? "?";
  const stealable = game.gifts.filter((g) => g.holderId !== null && g.holderId !== playerId && !g.frozen);

  async function open(e: FormEvent) {
    e.preventDefault();
    const trimmed = gift.trim();
    if (!trimmed) return;
    setGift("");
    await send({ type: "OpenGift", playerId, giftId: crypto.randomUUID(), name: trimmed });
  }

  return (
    <section className="card turn" aria-label={`${name}'s turn`}>
      <h2>{name}'s turn</h2>
      <form className="inline" onSubmit={open}>
        <label htmlFor={`gift-${playerId}`} className="visually-hidden">
          What's in {name}'s gift?
        </label>
        <input
          id={`gift-${playerId}`}
          placeholder={`What's in ${name}'s gift?`}
          autoComplete="off"
          maxLength={100}
          value={gift}
          onChange={(e) => setGift(e.target.value)}
        />
        <button type="submit" disabled={!gift.trim()}>
          Open gift
        </button>
      </form>
      {stealable.length > 0 && (
        <div className="steals">
          <p className="muted">Or steal:</p>
          {stealable.map((g) => (
            <button key={g.id} className="secondary" onClick={() => send({ type: "Steal", playerId, giftId: g.id })}>
              Steal {g.name} from {holderName(g.holderId)}
            </button>
          ))}
        </div>
      )}
      <button className="link" onClick={() => send({ type: "Skip", playerId })}>
        Skip {name}
      </button>
    </section>
  );
}

export function Gifts({ game }: { game: GameView }) {
  const holderName = (id: string | null) => (id === null ? "on the table" : (game.players.find((p) => p.id === id)?.name ?? "?"));
  return (
    <section className="card">
      <h2>Gifts</h2>
      <ul className="gifts" aria-label="Gifts">
        {game.gifts.map((g) => (
          <li key={g.id} aria-label={g.name}>
            <span>
              <strong>{g.name}</strong> — {holderName(g.holderId)}
            </span>
            <span className="muted">
              {g.steals > 0 && `${g.steals} ${g.steals === 1 ? "steal" : "steals"}`}
              {g.frozen && <span className="badge">Frozen</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
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
