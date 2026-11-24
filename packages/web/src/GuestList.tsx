/**
 * The guest list, for the Host and Co-hosts: a Player's email, so whoever signs in with it is that Player, by any
 * route (ADR 0007). Beside each name on the consoles: whether they're in yet, and ✉ to give, change or take off
 * the email. Guests never see emails.
 */
import { useEffect, useId, useState, type FormEvent } from "react";
import type { GameView, GuestListEntry } from "./api.js";
import { useApi } from "./ApiContext.js";

/** Each Player's guest-list entry, by playerId, for the Staff; nothing for anyone else. Reloaded when the Staff's data changes. */
export function useGuestList(game: GameView | null | "loading", changes: number): (playerId: string) => GuestListEntry | undefined {
  const api = useApi();
  const [list, setList] = useState<GuestListEntry[]>([]);
  const ready = game !== null && game !== "loading";
  const id = ready ? game.id : "";
  const runs = ready && game.role !== null;
  const players = ready ? game.players.length : 0;

  useEffect(() => {
    if (!runs) return setList([]);
    let current = true;
    api.guestList(id).then(
      (l) => current && setList(l),
      () => {}, // keep what we had
    );
    return () => {
      current = false;
    };
  }, [api, id, runs, changes, players]);

  return (playerId) => list.find((e) => e.playerId === playerId);
}

/** ✓ in, or ✉ not yet, with the email on hover; then ✉ to edit it. */
export function PlayerEmail({ gameId, playerId, name, entry }: { gameId: string; playerId: string; name: string; entry: GuestListEntry | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {entry && (
        <span className={entry.joined ? "guest-mark joined" : "guest-mark"} title={entry.email}>
          {entry.joined ? "✓ in" : "✉ not yet"}
        </span>
      )}{" "}
      <button
        type="button"
        className="link"
        aria-label={entry ? `Change ${name}'s email` : `Add ${name}'s email`}
        aria-expanded={open}
        title={entry ? `Email: ${entry.email}` : "Add their email, so they can sign in as this Player"}
        onClick={() => setOpen(!open)}
      >
        ✉
      </button>
      {open && <EmailForm gameId={gameId} playerId={playerId} name={name} entry={entry} onDone={() => setOpen(false)} />}
    </>
  );
}

function EmailForm({ gameId, playerId, name, entry, onDone }: { gameId: string; playerId: string; name: string; entry: GuestListEntry | undefined; onDone: () => void }) {
  const api = useApi();
  const ids = useId();
  const [email, setEmail] = useState(entry?.email ?? "");
  const [error, setError] = useState<string | null>(null);

  async function save(next: string | null) {
    const result = await api.setPlayerEmail(gameId, playerId, next);
    if (result.ok) onDone();
    else setError(result.message.endsWith(".") ? result.message : `${result.message}.`);
  }

  return (
    <form
      className="stack rename-form"
      aria-label={`${name}'s email`}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void save(email.trim());
      }}
    >
      <label htmlFor={`${ids}-email`}>{name}'s email</label>
      <input id={`${ids}-email`} type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
      <p className="muted hint">Whoever signs in with it plays as {name}, from their own phone.</p>
      <div className="inline">
        <button type="submit">Save</button>
        {entry && (
          <button type="button" className="secondary" onClick={() => void save(null)}>
            Take it off
          </button>
        )}
        <button type="button" className="secondary" onClick={onDone}>
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

/** A pasted line's email, if it has one: "Ann Lee, ann@corp.com", "Ann Lee <ann@corp.com>", or a spreadsheet row. */
const EMAIL = /[^\s<>,;:"'()[\]]+@[^\s<>,;:"'()[\]]+\.[^\s<>,;:"'()[\]]+/;

/** The name to use when a line is only an email: "ann.lee@corp.com" is Ann Lee. */
const nameFromEmail = (email: string) =>
  email
    .split("@")[0]!
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");

/** Splits a pasted line (list numbers and bullets already gone) into a name and, if there is one, an email. */
export function guestFrom(line: string): { name: string; email?: string } {
  const email = EMAIL.exec(line)?.[0];
  if (!email) return { name: line.split("\t")[0]!.trim() };
  const rest = line
    .replace(email, "")
    .split("\t")
    .map((cell) => cell.replace(/[<>,;:"()[\]]/g, " ").replace(/\s+/g, " ").trim())
    .find(Boolean);
  return { name: rest || nameFromEmail(email), email: email.toLowerCase() };
}
