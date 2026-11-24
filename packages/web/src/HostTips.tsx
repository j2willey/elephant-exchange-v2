/**
 * Jim's three things that make a gift swap go well, done before the party: set the Game up ahead of time, send the
 * link, and bring a few extra gifts. On the front page and in the Host's Guide for Hosts to come, and on a new Game's
 * console (BeforeTheParty) where a Host can act on them. Wording: the app adds to the party; phones are optional.
 */
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { GameView } from "./api.js";
import { CopyInvitation } from "./Welcome.js";

export const TIPS = [
  {
    icon: "📝",
    title: "Set up the Game ahead of time",
    body: "Create it a few days before the party and add When & where (\"Fri Dec 12, 10 am · Conference room B\"). Paste in the guest list now, so on the day you can start on time.",
  },
  {
    icon: "🔗",
    title: "Send the link",
    body: "Send the Game's link to your guests: in your own email, your team chat or the department list. Guests who'd like to can open it on their phones ahead of time and sign up; they'll see when and where it starts, and the Game waits until you start it.",
  },
  {
    icon: "🎁",
    title: "Bring 2 to 5 extra gifts",
    body: "Someone who chose with care (and maybe spent $40 against a $20 budget) can end up with the last-minute air freshener. After the Worst Gift Vote, let the holders of the worst gifts pick from the extras. And if someone forgot a gift, an extra one lets them play instead of watching from the sidelines.",
  },
] as const;

/** The three, as a numbered list. `actions` adds a Host's buttons under a step, by its index. */
export function TipList({ actions = {} }: { actions?: Partial<Record<number, ReactNode>> }) {
  return (
    <ol className="host-tips">
      {TIPS.map((t, i) => (
        <li key={t.title}>
          <span className="host-tip-icon" aria-hidden="true">
            {t.icon}
          </span>
          <div>
            <strong>{t.title}.</strong> {t.body}
            {actions[i] && <div className="inline host-tip-actions">{actions[i]}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** For Hosts to come, on the front page, under How it works (which links the Host's Guide). */
export function ThreeThings() {
  return (
    <section className="card" aria-label="Three things to do before the party">
      <h2>Three things to do before the party</h2>
      <TipList />
    </section>
  );
}

/**
 * On a Game's console before it starts, for its Host and Co-hosts: the three things, with what to tap for each. Hidden
 * for that Game on this device once they say Got it.
 */
export function BeforeTheParty({ game, onInvite }: { game: GameView; onInvite?: () => void }) {
  const key = `ee-tips-done-${game.id}`;
  const [done, setDone] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  if (done || game.phase !== "setup" || game.demo) return null;
  const settings = `/games/${game.id}/settings`;
  return (
    <section className="card before-the-party" aria-label="Before the party">
      <h2>Before the party</h2>
      <TipList
        actions={{
          0: game.whenWhere ? (
            <span className="muted">
              ✓ {game.whenWhere} · <Link to={settings}>Change</Link>
            </span>
          ) : (
            <Link to={settings}>⚙ Add When &amp; where</Link>
          ),
          1: onInvite ? (
            <button type="button" className="secondary" onClick={onInvite}>
              🔗 Invite
            </button>
          ) : (
            <CopyInvitation game={game} />
          ),
        }}
      />
      <button
        type="button"
        className="link"
        onClick={() => {
          setDone(true);
          try {
            localStorage.setItem(key, "1");
          } catch {
            // private browsing: it comes back on reload
          }
        }}
      >
        Got it, hide this
      </button>
    </section>
  );
}
