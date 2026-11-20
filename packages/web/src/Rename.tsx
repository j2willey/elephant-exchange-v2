import { useId, useState, type FormEvent } from "react";
import type { GameView } from "./api.js";
import { useApi } from "./ApiContext.js";

/**
 * For the Host and Co-hosts: a ✏️ beside someone's name that opens a small form to rename them everywhere (the
 * roster and every Post they've made), locked by default so they can't change it back. Found by their Player or by
 * one of their Posts, so no email is ever needed.
 */
export function RenameButton({ gameId, who, name, onDone }: { gameId: string; who: { playerId: string } | { postId: string }; name: string; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="link" aria-label={`Rename ${name}`} aria-expanded={open} title="Rename" onClick={() => setOpen(!open)}>
        ✏️
      </button>
      {open && (
        <RenameForm
          gameId={gameId}
          who={who}
          name={name}
          onDone={() => {
            setOpen(false);
            onDone?.();
          }}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
}

function RenameForm({
  gameId,
  who,
  name,
  onDone,
  onCancel,
}: {
  gameId: string;
  who: { playerId: string } | { postId: string };
  name: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const api = useApi();
  const ids = useId();
  const [next, setNext] = useState(name);
  const [locked, setLocked] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (await api.rename(gameId, who, next.trim(), locked)) onDone();
    else setError("That didn't work. Please try again.");
  }

  return (
    <form className="stack rename-form" aria-label={`Rename ${name}`} onSubmit={save}>
      <label htmlFor={`${ids}-name`}>New name</label>
      <input id={`${ids}-name`} required maxLength={100} autoComplete="off" value={next} onChange={(e) => setNext(e.target.value)} />
      <label className="check">
        <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} /> Lock it, so they can't change it back
      </label>
      <div className="inline">
        <button type="submit">Save</button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * Someone's own name in this Game, to change: a Player's on their You card, a Guest's once they've given one. Once
 * the Host or a Co-host has locked it, it just says so.
 */
export function MyName({ game, onChanged }: { game: GameView; onChanged: (name: string) => void }) {
  const api = useApi();
  const ids = useId();
  const current = game.myName?.name;
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  if (!current) return null;
  if (game.myName?.locked) return <p className="muted hint">Your Host set this name.</p>;

  async function save(e: FormEvent) {
    e.preventDefault();
    const name = next.trim();
    const result = await api.changeMyName(game.id, name);
    if (result === "ok") {
      setOpen(false);
      setError(null);
      api.setGuestName(name);
      onChanged(name);
    } else {
      setError(result === "locked" ? "Your Host set this name, so it can't be changed." : "That didn't work. Please try again.");
    }
  }

  if (!open)
    return (
      <button
        type="button"
        className="link"
        onClick={() => {
          setNext(current);
          setOpen(true);
        }}
      >
        ✏️ Change my name
      </button>
    );
  return (
    <form className="stack rename-form" aria-label="Change my name" onSubmit={save}>
      <label htmlFor={`${ids}-name`}>Your name</label>
      <input id={`${ids}-name`} required maxLength={100} autoComplete="given-name" value={next} onChange={(e) => setNext(e.target.value)} />
      <div className="inline">
        <button type="submit">Save</button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
