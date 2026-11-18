import { useState } from "react";

/**
 * Names from a pasted list, one per line, as it comes from an email or a spreadsheet: list numbers and bullets
 * are dropped, and only a spreadsheet row's first cell is kept. Blank lines go, and so does anyone already on the
 * roster or listed twice (ignoring case), so pasting the same list again adds nobody twice.
 */
export function namesFrom(text: string, roster: string[]): { names: string[]; skipped: number } {
  const seen = new Set(roster.map((n) => n.toLowerCase()));
  const names: string[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    const name = line
      .split("\t")[0]!
      .replace(/^\s*(?:\d+[.)]|[-*•·])\s+/, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100);
    if (!name) continue;
    if (seen.has(name.toLowerCase())) {
      skipped++;
      continue;
    }
    seen.add(name.toLowerCase());
    names.push(name);
  }
  return { names, skipped };
}

/** v1's roster box: the Host pastes the whole guest list before the start instead of typing each name. */
export function RosterPaste({ roster, onAdd }: { roster: string[]; onAdd: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const { names, skipped } = namesFrom(text, roster);

  async function add() {
    setBusy(true);
    // One at a time, in the list's order: the roster shows them as listed.
    for (const name of names) await onAdd(name);
    setBusy(false);
    setText("");
    setOpen(false);
    setDone(`Added ${names.length} ${names.length === 1 ? "player" : "players"}` + (skipped ? `, skipped ${skipped} already on the list.` : "."));
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
      <textarea id="roster-paste" rows={8} autoFocus placeholder={"Ann Smith\nBob Jones\n…"} value={text} onChange={(e) => setText(e.target.value)} />
      {skipped > 0 && <p className="muted hint">{skipped === 1 ? "1 name is" : `${skipped} names are`} already on the list and will be skipped.</p>}
      <div className="inline">
        <button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="button" disabled={busy || names.length === 0} onClick={() => void add()}>
          {busy ? "Adding…" : `Add ${names.length} ${names.length === 1 ? "player" : "players"}`}
        </button>
      </div>
    </div>
  );
}
