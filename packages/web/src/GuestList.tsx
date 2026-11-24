/**
 * The guest list, for the Host and Co-hosts: a Player's email, so whoever signs in with it is that Player, by any
 * route (ADR 0007). Beside each name on the consoles: whether they're in yet, and ✉ to give, change or take off
 * the email. Guests never see emails.
 */
import { useEffect, useId, useState, type FormEvent } from "react";
import type { GameView, GuestListEntry } from "./api.js";
import { useApi } from "./ApiContext.js";

/** The guest list, for the Staff; empty for anyone else. Reloaded when the Staff's data changes. */
export function useGuestList(game: GameView | null | "loading", changes: number): GuestListEntry[] {
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

  return list;
}

/** Who on the guest list hasn't opened the Game or been emailed an invitation yet. */
export const notInvited = (list: GuestListEntry[]) => list.filter((e) => !e.joined && e.invitedAt === null);

/** ✓ in, or ✉ not yet, with the email on hover; then ✉ to edit it. */
export function PlayerEmail({ gameId, playerId, name, entry }: { gameId: string; playerId: string; name: string; entry: GuestListEntry | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {entry && (
        <span className={entry.joined ? "guest-mark joined" : "guest-mark"} title={entry.email}>
          {entry.joined ? "✓ in" : entry.invitedAt !== null ? "✉ invited" : "not yet"}
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
  const [inviting, setInviting] = useState<"idle" | "sending" | "sent">("idle");

  async function invite() {
    setInviting("sending");
    const result = await api.sendInvitations(gameId, [playerId]);
    if ("error" in result) {
      setInviting("idle");
      return setError(result.error);
    }
    const no = result.notSent[0];
    setInviting(no ? "idle" : "sent");
    setError(no ? `${no.reason}.` : null);
  }

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
      {entry && !entry.joined && (
        <p>
          {inviting === "sent" ? (
            <span role="status">Invitation sent to {entry.email}.</span>
          ) : (
            <button type="button" className="link" disabled={inviting === "sending"} onClick={() => void invite()}>
              ✉ {entry.invitedAt !== null ? "Send the invitation again" : "Email an invitation"}
            </button>
          )}
        </p>
      )}
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

/**
 * "Email invitations": one personal invitation each to everyone on the guest list who isn't in or invited yet. Each
 * link signs its person in once, as their Player. Says how many it sent, and who it couldn't, and why.
 */
export function SendInvitations({ game, list }: { game: GameView; list: GuestListEntry[] }) {
  const api = useApi();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const waiting = notInvited(list);
  const nameOf = (playerId: string) => game.players.find((p) => p.id === playerId)?.name ?? "?";
  if (game.phase === "ended") return null;

  async function send() {
    setBusy(true);
    const result = await api.sendInvitations(game.id);
    setBusy(false);
    setConfirming(false);
    if ("error" in result) return setSaid(result.error);
    setSaid(
      `Sent ${result.sent.length} ${result.sent.length === 1 ? "invitation" : "invitations"}.` +
        (result.notSent.length ? ` Not sent: ${result.notSent.map((n) => `${nameOf(n.playerId)} (${n.reason})`).join(", ")}.` : ""),
    );
  }

  if (list.length === 0)
    return (
      <p className="muted hint">
        Want to email each person their own invitation? Add their emails: ✉ beside a name, or Paste a list with emails.
      </p>
    );
  return (
    <div className="stack send-invitations">
      {said && (
        <p role="status" className="muted">
          {said}
        </p>
      )}
      {waiting.length === 0 ? (
        !said && <p className="muted hint">Everyone on the guest list is in or has been invited.</p>
      ) : confirming ? (
        <>
          <p>
            Email {waiting.length === 1 ? "1 person" : `${waiting.length} people`} their own invitation? Each link signs its
            person in as their Player, so they're in without typing anything. It comes from Elephant Exchange's address,
            so it may land in spam.
          </p>
          <div className="inline">
            <button type="button" disabled={busy} onClick={() => void send()}>
              {busy ? "Sending…" : "Send"}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="secondary" onClick={() => setConfirming(true)}>
          ✉ Email invitations ({waiting.length} not invited yet)
        </button>
      )}
    </div>
  );
}
