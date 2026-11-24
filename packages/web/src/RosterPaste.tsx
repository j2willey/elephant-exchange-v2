import { useState } from "react";
import { useApi } from "./ApiContext.js";
import { guestFrom } from "./GuestList.js";

/**
 * Players from a pasted list, one per line, as it comes from an email or a spreadsheet: list numbers and bullets
 * are dropped, and a spreadsheet row's first cell is the name. A line may carry an email too ("Ann Lee,
 * ann@corp.com"), putting them on the guest list (GuestList.tsx). Blank lines go, and so does anyone already on
 * the roster or listed twice (ignoring case), so pasting the same list again adds nobody twice.
 */
export function playersFrom(text: string, roster: string[]): { players: { name: string; email?: string }[]; skipped: number } {
  const seen = new Set(roster.map((n) => n.toLowerCase()));
  const emails = new Set<string>();
  const players: { name: string; email?: string }[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    const { name: raw, email } = guestFrom(line.replace(/^\s*(?:\d+[.)]|[-*•·])\s+/, ""));
    const name = raw.replace(/\s+/g, " ").trim().slice(0, 100);
    if (!name) continue;
    if (seen.has(name.toLowerCase()) || (email && emails.has(email))) {
      skipped++;
      continue;
    }
    seen.add(name.toLowerCase());
    if (email) emails.add(email);
    players.push(email ? { name, email } : { name });
  }
  return { players, skipped };
}

/** v1's roster box: the Host pastes the whole guest list before the start instead of typing each name. */
export function RosterPaste({ gameId, roster, onAdd }: { gameId: string; roster: string[]; onAdd: (name: string) => Promise<void> }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const { players, skipped } = playersFrom(text, roster);

  async function add() {
    setBusy(true);
    // One at a time, in the list's order: the roster shows them as listed.
    const refused: string[] = [];
    for (const { name, email } of players) {
      if (!email) await onAdd(name);
      else {
        const added = await api.addGuest(gameId, name, email);
        if (!added.ok) refused.push(`${name}: ${added.message}`);
      }
    }
    api.noteFeature(gameId, "rosterPaste"); // for the statistics: the log shows only the names added
    setBusy(false);
    setText("");
    setOpen(false);
    const added = players.length - refused.length;
    setDone(
      `Added ${added} ${added === 1 ? "player" : "players"}` +
        (skipped ? `, skipped ${skipped} already on the list` : "") +
        (refused.length ? `. Not added: ${refused.join("; ")}.` : "."),
    );
  }

  if (!open) {
    return (
      <p className="roster-paste-link">
        <button
          className="link"
          onClick={() => {
            setOpen(true);
            setDone(null);
          }}
        >
          📋 Paste a list
        </button>
        {done && (
          <span role="status" className="muted">
            {" "}
            {done}
          </span>
        )}
      </p>
    );
  }
  return (
    <div className="stack roster-paste">
      <label htmlFor="roster-paste">Names, one per line</label>
      <p className="muted hint" id="roster-paste-hint">
        Add an email after a name (Ann Smith, ann@example.com) and whoever signs in with it plays as that Player, from
        their own phone.
      </p>
      <textarea id="roster-paste" rows={8} autoFocus aria-describedby="roster-paste-hint" placeholder={"Ann Smith\nBob Jones, bob@example.com\n…"} value={text} onChange={(e) => setText(e.target.value)} />
      {skipped > 0 && <p className="muted hint">{skipped === 1 ? "1 name is" : `${skipped} names are`} already on the list and will be skipped.</p>}
      <div className="inline">
        <button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="button" disabled={busy || players.length === 0} onClick={() => void add()}>
          {busy ? "Adding…" : `Add ${players.length} ${players.length === 1 ? "player" : "players"}`}
        </button>
      </div>
    </div>
  );
}
