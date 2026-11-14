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

      {game.phase === "ended" ? (
        <section className="card">
          <h2>Game over</h2>
          <p className="muted">Here's who went home with what.</p>
        </section>
      ) : (
        game.phase !== "setup" && (
          <section className="card" aria-live="polite">
            {game.phase === "finalRound" && <h2>Final Round</h2>}
            <p>
              Up now: <strong>{game.active.map(nameOf).join(", ") || "nobody"}</strong>
            </p>
            <p>
              On deck: <strong>{game.onDeck.map(nameOf).join(", ") || "nobody"}</strong>
            </p>
            {game.phase === "finalRound" && (
              <p className="muted">
                {game.leftoverGifts} unopened {game.leftoverGifts === 1 ? "gift" : "gifts"} left
              </p>
            )}
            {runs && (
              <button className="secondary" onClick={() => send({ type: "Undo" })}>
                Undo last pick
              </button>
            )}
          </section>
        )
      )}

      {runs &&
        (game.phase === "playing" || game.phase === "finalRound") &&
        game.active.map((playerId) => <Turn key={playerId} game={game} playerId={playerId} send={send} />)}

      {runs && game.phase === "playing" && game.active.length === 0 && game.gifts.length > 0 && (
        <FinalRoundPanel game={game} send={send} />
      )}

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

      {runs && game.phase !== "ended" && <EndGame send={send} />}
    </div>
  );
}

/** Offered once every Turn is done. The Final Round isn't mentioned before then. */
function FinalRoundPanel({ game, send }: { game: GameView; send: (c: Command) => Promise<void> }) {
  const holders = game.players.filter((p) => game.gifts.some((g) => g.holderId === p.id)).length;
  const [finalists, setFinalists] = useState(String(holders));
  const [leftovers, setLeftovers] = useState("0");

  function submit(e: FormEvent) {
    e.preventDefault();
    void send({ type: "StartFinalRound", finalists: Number(finalists), leftoverGifts: Number(leftovers) });
  }

  return (
    <section className="card" aria-label="Final Round">
      <form className="stack" onSubmit={submit}>
        <h2>Ready for the Final Round?</h2>
        <p className="muted">Everyone has a Gift. Players get a last chance, one at a time, in the order they were drawn.</p>
        <label htmlFor="finalists">How many Players get a final chance?</label>
        <input id="finalists" type="number" inputMode="numeric" min={0} max={holders} required value={finalists} onChange={(e) => setFinalists(e.target.value)} />
        <label htmlFor="leftovers">How many unopened Gifts are left on the table?</label>
        <input id="leftovers" type="number" inputMode="numeric" min={0} max={200} required value={leftovers} onChange={(e) => setLeftovers(e.target.value)} />
        <button type="submit">Start the Final Round</button>
      </form>
    </section>
  );
}

/** The Host may end the Game at any moment (the room booking may run out), but never by one stray tap. */
function EndGame({ send }: { send: (c: Command) => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button className="link danger" onClick={() => setAsking(true)}>
        End the Game
      </button>
    );
  }
  return (
    <section className="card">
      <p>End the Game now? Everyone keeps the Gift they're holding, and nobody else gets a turn.</p>
      <div className="inline">
        <button className="danger-solid" onClick={() => void send({ type: "EndGame" })}>
          Yes, end it now
        </button>
        <button className="secondary" onClick={() => setAsking(false)}>
          Keep playing
        </button>
      </div>
    </section>
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

/** One active Player's Turn: open a Gift, steal one, or skip them. In the Final Round: keep, steal, or take. */
function Turn({ game, playerId, send }: { game: GameView; playerId: string; send: (c: Command) => Promise<void> }) {
  const name = game.players.find((p) => p.id === playerId)?.name ?? "?";
  const [gift, setGift] = useState("");
  const holderName = (id: string | null) => game.players.find((p) => p.id === id)?.name ?? "?";
  const final = game.phase === "finalRound";
  const held = game.gifts.find((g) => g.holderId === playerId);
  const stealable = game.gifts.filter((g) => g.holderId !== null && g.holderId !== playerId && !g.frozen);
  const onTable = game.gifts.filter((g) => g.holderId === null);
  const canOpen = !final || game.leftoverGifts > 0;

  async function open(e: FormEvent) {
    e.preventDefault();
    const trimmed = gift.trim();
    if (!trimmed) return;
    setGift("");
    await send({ type: "OpenGift", playerId, giftId: crypto.randomUUID(), name: trimmed });
  }

  return (
    <section className="card turn" aria-label={final ? `${name}'s final turn` : `${name}'s turn`}>
      <h2>{final ? `${name}'s final turn` : `${name}'s turn`}</h2>
      {final && held && (
        <button onClick={() => send({ type: "KeepGift", playerId })}>Keep {held.name}</button>
      )}
      {canOpen && (
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
      )}
      {onTable.length > 0 && (
        <div className="steals">
          <p className="muted">On the table:</p>
          {onTable.map((g) => (
            <button key={g.id} className="secondary" onClick={() => send({ type: "TakeReturnedGift", playerId, giftId: g.id })}>
              Take {g.name}
            </button>
          ))}
        </div>
      )}
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
      {!final && (
        <button className="link" onClick={() => send({ type: "Skip", playerId })}>
          Skip {name}
        </button>
      )}
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
