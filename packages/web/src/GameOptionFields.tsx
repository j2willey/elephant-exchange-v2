import { useId, useState, type ReactNode } from "react";
import type { GameOptions } from "@elephant/rules";

/**
 * What each option is for, in a Host's words: shown under a tap on its ⓘ (a tap, not a hover, so it works on phones).
 * Drawn from the Host's Guide; first drafts for Jim and friends to review.
 */
export const OPTION_HELP: Record<keyof GameOptions, ReactNode> = {
  activeSlots: (
    <>
      How many Players are up at the same time. <strong>1</strong> is the classic game: the whole room watches every
      Pick. With 20 or more guests, <strong>2 or 3</strong> keeps the party moving: while one Player unwraps, the next is
      already choosing, and nobody waits an hour for a turn. Each Player still gets exactly one turn.
    </>
  ),
  maxSteals: (
    <>
      A Gift is <strong>Frozen</strong> by the Steal that reaches this number: whoever made that Steal keeps it for good.
      <strong> 3</strong> is the classic limit. Fewer makes a shorter game; more makes more drama. 0 means no Steals at
      all: everyone keeps what they open.
    </>
  ),
  turnSeconds: (
    <>
      A countdown on the scoreboard for each Player who's up. It turns amber, then red: a friendly nudge, not a rule.
      Nobody loses their turn when it runs out, and you can restart it (say, after explaining the rules to someone).
      A minute suits most parties. <strong>0</strong> shows no timer.
    </>
  ),
  rosterMode: (
    <>
      <strong>I'll enter them:</strong> you or a Co-host type the names, or paste the guest list from an email or a
      spreadsheet. <strong>Players sign up on their phones:</strong> guests scan the QR code or follow the link and add
      themselves as they arrive. Either way, you can add, rename or remove anyone.
    </>
  ),
  approveNames: (
    <>
      For a tough crowd. A name someone picks for themselves shows as "New player" or "Guest" until you or a Co-host
      approves it. You can rename anyone, and lock the name, either way.
    </>
  ),
  moderation: (
    <>
      Guests can post words and Photos to the party's Feed, which shows on their phones and the big screen.{" "}
      <strong>Open:</strong> Posts appear at once. <strong>Approval:</strong> each waits for you or a Co-host.{" "}
      <strong>Paused:</strong> nobody can post. You can switch at any time, and hide any Post.
    </>
  ),
};

/** An option's label with an ⓘ beside it; tapping it shows what the option is for. */
function Labelled({ htmlFor, label, help, children }: { htmlFor?: string; label: string; help: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const helpId = useId();
  return (
    <div className="option">
      <div className="option-label">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="legend-like">{label}</span>}
        <button
          type="button"
          className="info"
          aria-label="What's this for?"
          title={`What "${label}" is for`}
          aria-expanded={open}
          aria-controls={helpId}
          onClick={() => setOpen((o) => !o)}
        >
          ⓘ
        </button>
      </div>
      {open && (
        <p id={helpId} className="info-text">
          {help}
        </p>
      )}
      {children}
    </div>
  );
}

const postingChoices: { mode: GameOptions["moderation"]; label: string }[] = [
  { mode: "open", label: "Open: Posts appear at once" },
  { mode: "approval", label: "Approval: each Post waits for you" },
  { mode: "paused", label: "Paused: nobody can post" },
];

/**
 * Every option a Host can choose for a Game, each explained under its ⓘ. Numbers are kept as typed (text) until the
 * form is sent, so a Host can clear a box to type a new number.
 */
export type OptionDraft = Omit<GameOptions, "activeSlots" | "maxSteals" | "turnSeconds"> & { activeSlots: string; maxSteals: string; turnSeconds: string };

export const toDraft = (o: GameOptions): OptionDraft => ({
  ...o,
  activeSlots: String(o.activeSlots),
  maxSteals: String(o.maxSteals),
  turnSeconds: String(o.turnSeconds),
});

export const fromDraft = (d: OptionDraft): GameOptions => ({
  ...d,
  activeSlots: Number(d.activeSlots),
  maxSteals: Number(d.maxSteals),
  turnSeconds: Number(d.turnSeconds),
});

export function GameOptionFields({ value, onChange }: { value: OptionDraft; onChange: (next: OptionDraft) => void }) {
  const set = <K extends keyof OptionDraft>(key: K, v: OptionDraft[K]) => onChange({ ...value, [key]: v });
  return (
    <div className="stack options">
      <h3>The rules</h3>
      <Labelled htmlFor="slots" label="Players taking a turn at once" help={OPTION_HELP.activeSlots}>
        <input id="slots" type="number" inputMode="numeric" min={1} max={10} required value={value.activeSlots} onChange={(e) => set("activeSlots", e.target.value)} />
      </Labelled>
      <Labelled htmlFor="steals" label="Steals before a Gift is Frozen" help={OPTION_HELP.maxSteals}>
        <input id="steals" type="number" inputMode="numeric" min={0} max={20} required value={value.maxSteals} onChange={(e) => set("maxSteals", e.target.value)} />
      </Labelled>
      <Labelled htmlFor="turn-seconds" label="Seconds per turn" help={OPTION_HELP.turnSeconds}>
        <input
          id="turn-seconds"
          type="number"
          inputMode="numeric"
          min={0}
          max={600}
          required
          value={value.turnSeconds}
          onChange={(e) => set("turnSeconds", e.target.value)}
        />
      </Labelled>

      <h3>The guests</h3>
      <Labelled label="Who adds the Players?" help={OPTION_HELP.rosterMode}>
        <fieldset className="choices">
          <legend className="visually-hidden">Who adds the Players?</legend>
          <label>
            <input type="radio" name="roster-mode" checked={value.rosterMode === "host"} onChange={() => set("rosterMode", "host")} />
            I'll enter them
          </label>
          <label>
            <input type="radio" name="roster-mode" checked={value.rosterMode === "self"} onChange={() => set("rosterMode", "self")} />
            Players sign up on their phones
          </label>
        </fieldset>
      </Labelled>
      <Labelled label="Approve names" help={OPTION_HELP.approveNames}>
        <label className="check">
          <input type="checkbox" checked={value.approveNames} onChange={(e) => set("approveNames", e.target.checked)} /> Approve names before everyone
          sees them
        </label>
      </Labelled>

      <h3>The party Feed</h3>
      <Labelled label="Posting" help={OPTION_HELP.moderation}>
        <fieldset className="choices">
          <legend className="visually-hidden">Posting</legend>
          {postingChoices.map(({ mode, label }) => (
            <label key={mode}>
              <input type="radio" name="posting" checked={value.moderation === mode} onChange={() => set("moderation", mode)} />
              {label}
            </label>
          ))}
        </fieldset>
      </Labelled>
    </div>
  );
}

/** The options in a line, for a Host who starts with their saved ones: "2 at a time · Frozen after 3 Steals · …". */
export function optionsInWords(o: GameOptions): string {
  return [
    o.activeSlots === 1 ? "1 Player at a time" : `${o.activeSlots} Players at a time`,
    o.maxSteals === 0 ? "no Steals" : `Frozen after ${o.maxSteals} ${o.maxSteals === 1 ? "Steal" : "Steals"}`,
    o.turnSeconds === 0 ? "no timer" : `${o.turnSeconds}-second timer`,
    o.rosterMode === "self" ? "guests sign up on their phones" : "you enter the Players",
    ...(o.approveNames ? ["names approved first"] : []),
    o.moderation === "open" ? "open Feed" : o.moderation === "approval" ? "Posts approved first" : "Feed paused",
  ].join(" · ");
}
