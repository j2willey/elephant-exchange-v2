import { useEffect, useId, useState, type FormEvent } from "react";
import type { GameView, PendingName, RenameWho } from "./api.js";
import { useApi } from "./ApiContext.js";

/**
 * For the Host and Co-hosts: a ✏️ beside someone's name that opens a small form to rename them everywhere (the
 * roster and every Post they've made), locked by default so they can't change it back. Found by their Player or by
 * one of their Posts, so no email is ever needed.
 */
export function RenameButton({
  gameId,
  who,
  name,
  label = "✏️",
  onDone,
}: {
  gameId: string;
  who: RenameWho;
  name: string;
  label?: string;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="link" aria-label={`Rename ${name}`} aria-expanded={open} title="Rename" onClick={() => setOpen(!open)}>
        {label}
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
  who: RenameWho;
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
export function MyName({ game, onChanged }: { game: GameView; onChanged: (myName: NonNullable<GameView["myName"]>) => void }) {
  const api = useApi();
  const ids = useId();
  const current = game.myName?.name;
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const pending = game.myName?.pending;
  if (!current && !pending) return null;
  if (game.myName?.locked) return <p className="muted hint">Your Host set this name.</p>;
  const waiting = pending && <p className="muted hint">Waiting for your Host to OK "{pending}".</p>;

  async function save(e: FormEvent) {
    e.preventDefault();
    const name = next.trim();
    const result = await api.changeMyName(game.id, name);
    if (result === "ok" || result === "waiting") {
      setOpen(false);
      setError(null);
      api.setGuestName(name);
      onChanged(result === "ok" ? { name, locked: false, pending: null } : { name: current ?? null, locked: false, pending: name });
    } else {
      setError(result === "locked" ? "Your Host set this name, so it can't be changed." : "That didn't work. Please try again.");
    }
  }

  if (!open)
    return (
      <>
        {waiting}
        <button
          type="button"
          className="link"
          onClick={() => {
            setNext(pending ?? current ?? "");
            setOpen(true);
          }}
        >
          ✏️ Change my name
        </button>
      </>
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

/**
 * Under Approve names, for the Host and Co-hosts: each name someone asked for, to approve as it is or rename (and
 * lock) instead. Shown only while any are waiting; reloaded whenever one is asked for or settled.
 */
export function NamesToApprove({ game, changes }: { game: GameView; changes: number }) {
  const api = useApi();
  const [pending, setPending] = useState<PendingName[]>([]);
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    let current = true;
    api.pendingNames(game.id).then(
      (list) => current && setPending(list),
      () => {}, // keep what we had
    );
    return () => {
      current = false;
    };
  }, [api, game.id, changes, asked]);

  if (pending.length === 0) return null;
  return (
    <section className="card names-waiting" aria-label="Names to approve">
      <h2>Names to approve</h2>
      <ul className="people">
        {pending.map((p) => (
          <li key={p.key} aria-label={p.wants}>
            <span className="person">
              <strong>{p.wants}</strong>
              <span className="muted"> (shown as {p.shown} for now)</span>
            </span>
            <span className="inline">
              <button type="button" onClick={() => void api.approveName(game.id, p.key).then(() => setAsked((n) => n + 1))}>
                Approve
              </button>
              <RenameButton gameId={game.id} who={{ key: p.key }} name={p.wants} label="✏️ Rename" onDone={() => setAsked((n) => n + 1)} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
