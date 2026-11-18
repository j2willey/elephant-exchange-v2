import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { renderSVG } from "uqr";
import type { Command } from "@elephant/rules";
import type { GameView, Post, SharedGame, Viewer } from "./api.js";
import { Countdown } from "./Countdown.js";
import { Feed } from "./Feed.js";
import { EndGame } from "./GameSettings.js";
import { ThemeLogo } from "./theme.js";
import { VotePanel } from "./Vote.js";

type Player = GameView["players"][number];
type Gift = GameView["gifts"][number];

/**
 * The Host console on a laptop, laid out as v1's was: a banner, a menu bar, the Participants beside the Gift
 * Tracker, and End Game at the foot. The Player who's up is at the top of the Participants with the turn's buttons;
 * a Steal is made by picking the Gift in the Gift Tracker. On a phone the single-column console is used instead.
 */
export function LaptopConsole({
  game,
  send,
  error,
  accept,
  posts,
  reloadFeed,
  resetTimer,
  joinPanel,
  finalRoundPanel,
}: {
  game: GameView;
  send: (command: Command) => Promise<void>;
  error: string | null;
  accept: (game: SharedGame | null, viewer?: Partial<Viewer>) => void;
  posts: Post[];
  reloadFeed: () => void;
  resetTimer: (playerId: string) => Promise<void>;
  /** Shown when the Host may join as a Player too (a Self sign-up Game). */
  joinPanel: React.ReactNode;
  finalRoundPanel: React.ReactNode;
}) {
  const [stealer, setStealer] = useState<string | null>(null);
  const [opening, setOpening] = useState<Player | null>(null);
  const [inviting, setInviting] = useState(false);
  const playing = game.phase === "playing" || game.phase === "finalRound";
  // A steal in progress ends once that Player is no longer up (their turn was taken, undone or skipped).
  const stealing = stealer !== null && game.active.includes(stealer) ? stealer : null;
  const nameOf = (id: string | null) => game.players.find((p) => p.id === id)?.name ?? "?";

  async function steal(gift: Gift) {
    if (!stealing) return;
    setStealer(null);
    await send(gift.holderId === null ? { type: "TakeReturnedGift", playerId: stealing, giftId: gift.id } : { type: "Steal", playerId: stealing, giftId: gift.id });
  }

  return (
    <div className="laptop">
      <header role="banner" className="lc-banner">
        <ThemeLogo theme={game.theme} />
        <div>
          <h2>{game.name}</h2>
          <p>
            {game.settings.activeSlots === 1 ? "1 player takes a turn at once" : `${game.settings.activeSlots} players take a turn at once`} ·{" "}
            {game.settings.maxSteals === 0 ? "no steals" : `Gifts are frozen after ${game.settings.maxSteals} steals`}
          </p>
        </div>
      </header>

      <nav className="lc-menu" aria-label="Console">
        <a href={`/games/${game.id}/screen`} target="_blank" rel="noopener">
          📺 Scoreboard
        </a>
        <button className="secondary" onClick={() => setInviting(true)}>
          🔗 Invite
        </button>
        <span className="lc-menu-right">
          {game.demo && window.self === window.top && <Link to={`/games/${game.id}/demo`}>🖥 Demo view</Link>}
          <Link to={`/games/${game.id}/settings`}>⚙ Settings</Link>
        </span>
      </nav>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="lc-columns">
        <section className="card" aria-label="Participants">
          <div className="lc-head">
            <h2>Participants</h2>
            {playing && (
              <button className="secondary" onClick={() => void send({ type: "Undo" })}>
                ↩ Undo last pick
              </button>
            )}
          </div>
          {game.phase === "finalRound" && (
            <p className="lc-note">
              Final Round · {game.leftoverGifts} unopened {game.leftoverGifts === 1 ? "gift" : "gifts"} left
            </p>
          )}
          {game.phase !== "ended" && <AddParticipant onAdd={(name) => send({ type: "AddPlayer", playerId: crypto.randomUUID(), name })} />}
          {game.phase === "setup" && (
            <>
              <button disabled={game.players.length < 2} onClick={() => void send({ type: "StartGame" })}>
                Start game
              </button>
              {game.players.length < 2 && <p className="muted hint">Add at least 2 players to start.</p>}
            </>
          )}
          {game.players.length === 0 ? (
            <p className="muted">No participants yet.</p>
          ) : (
            <ul className="lc-players">
              {inPlayOrder(game).map((p) => (
                <ParticipantRow
                  key={p.id}
                  game={game}
                  player={p}
                  stealing={stealing === p.id}
                  onOpen={() => setOpening(p)}
                  onSteal={() => setStealer(p.id)}
                  onCancelSteal={() => setStealer(null)}
                  send={send}
                  resetTimer={() => resetTimer(p.id)}
                />
              ))}
            </ul>
          )}
          {joinPanel}
        </section>

        <div className="lc-right">
          {finalRoundPanel}
          {game.phase === "ended" && (
            <>
              <section className="card">
                <h2>Game over</h2>
                <p className="muted">Here's who went home with what.</p>
              </section>
              <VotePanel game={game} accept={accept} />
            </>
          )}
          <section className="card" aria-label="Gift Tracker">
            <h2>Gift Tracker</h2>
            {stealing && <p className="lc-note">Pick the Gift {nameOf(stealing)} takes.</p>}
            {game.gifts.length === 0 ? (
              <p className="muted">No gifts opened yet.</p>
            ) : (
              <ul className="lc-gifts">
                {game.gifts.map((g) => {
                  const takeable = stealing !== null && g.holderId !== stealing && !g.frozen;
                  return (
                    <li key={g.id} aria-label={g.name}>
                      <span className="lc-gift-name">
                        <strong>{g.name}</strong>
                        {g.frozen && <span className="badge">Frozen</span>}
                      </span>
                      <span className="muted">{g.holderId === null ? "On the table" : <>Held by <strong>{nameOf(g.holderId)}</strong></>}</span>
                      <span className="lc-steals">
                        {g.steals}/{game.settings.maxSteals} steals
                      </span>
                      {takeable && (
                        <button onClick={() => void steal(g)} aria-label={`Select gift ${g.name}`}>
                          Select gift
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <Feed game={game} posts={posts} reload={reloadFeed} offerSignIn={false} composer={false} />
        </div>
      </div>

      <footer className="lc-foot">
        {game.phase !== "ended" && <EndGame game={game} onEnded={accept} label="🛑 End Game" />}
        <span className="lc-legend muted">🎁 Open · 😈 Steal · ⤵ Skip · 🕒 Reset timer · ↩ Undo</span>
      </footer>

      {opening && (
        <OpenGiftDialog
          name={opening.name}
          onCancel={() => setOpening(null)}
          onSave={async (giftName) => {
            const playerId = opening.id;
            setOpening(null);
            await send({ type: "OpenGift", playerId, giftId: crypto.randomUUID(), name: giftName });
          }}
        />
      )}
      {inviting && <InviteDialog gameId={game.id} onClose={() => setInviting(false)} />}
    </div>
  );
}

/** Who's up first, then who's on deck, then everyone still waiting, then those who have a Gift; before the start, as added. */
function inPlayOrder(game: GameView): Player[] {
  if (game.phase === "setup") return game.players;
  const rank = (p: Player) =>
    game.active.includes(p.id) ? 0 : game.onDeck.includes(p.id) ? 1 : game.gifts.some((g) => g.holderId === p.id) ? 3 : 2;
  const first = (p: Player) => (game.active.includes(p.id) ? game.active.indexOf(p.id) : game.onDeck.indexOf(p.id));
  return [...game.players].sort((a, b) => rank(a) - rank(b) || first(a) - first(b));
}

function ParticipantRow({
  game,
  player,
  stealing,
  onOpen,
  onSteal,
  onCancelSteal,
  send,
  resetTimer,
}: {
  game: GameView;
  player: Player;
  stealing: boolean;
  onOpen: () => void;
  onSteal: () => void;
  onCancelSteal: () => void;
  send: (command: Command) => Promise<void>;
  resetTimer: () => Promise<void>;
}) {
  const up = game.active.includes(player.id) && (game.phase === "playing" || game.phase === "finalRound");
  const onDeck = game.onDeck.includes(player.id);
  const held = game.gifts.find((g) => g.holderId === player.id);
  const final = game.phase === "finalRound";
  const status = up ? "up now" : onDeck ? "on deck" : held ? `holding ${held.name}` : game.phase === "setup" ? "added" : "waiting";

  return (
    <li aria-label={`${player.name} — ${status}`} className={up ? "lc-up" : undefined}>
      <span className="lc-name">{player.name}</span>
      {up ? (
        <span className="lc-turn">
          <Countdown game={game} playerId={player.id} name={player.name} />
          {stealing ? (
            <>
              <span className="lc-note">Select a gift in the Gift Tracker →</span>
              <button className="lc-act" aria-label={`Cancel ${player.name}'s steal`} onClick={onCancelSteal}>
                ❌
              </button>
            </>
          ) : (
            <>
              {final && held && (
                <button className="lc-act lc-wide" onClick={() => void send({ type: "KeepGift", playerId: player.id })}>
                  Keep {held.name}
                </button>
              )}
              {(!final || game.leftoverGifts > 0) && (
                <button className="lc-act" aria-label={`Open a gift for ${player.name}`} title="Open" onClick={onOpen}>
                  🎁
                </button>
              )}
              <button className="lc-act" aria-label={`Steal for ${player.name}`} title="Steal" onClick={onSteal}>
                😈
              </button>
              {!final && (
                <button className="lc-act" aria-label={`Skip ${player.name}`} title="Skip" onClick={() => void send({ type: "Skip", playerId: player.id })}>
                  ⤵
                </button>
              )}
              {game.clock.turnSeconds > 0 && (
                <button className="lc-act" aria-label={`Reset ${player.name}'s timer`} title="Reset timer" onClick={() => void resetTimer()}>
                  🕒
                </button>
              )}
            </>
          )}
        </span>
      ) : (
        <span className="lc-state muted">
          {onDeck ? <span className="badge">On deck</span> : held ? `🎁 ${held.name}` : game.phase === "setup" ? "" : "⏳"}
          {game.phase === "setup" && (
            <button className="link" aria-label={`Remove ${player.name}`} onClick={() => void send({ type: "RemovePlayer", playerId: player.id })}>
              Remove
            </button>
          )}
        </span>
      )}
    </li>
  );
}

/** Quick entry, as in v1: the box clears and keeps focus for the next name. */
function AddParticipant({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setName("");
    await onAdd(trimmed);
  }
  return (
    <form className="inline" onSubmit={submit}>
      <label htmlFor="lc-name" className="visually-hidden">
        Participant's name
      </label>
      <input id="lc-name" placeholder="Name" autoComplete="off" autoCapitalize="words" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      <button type="submit" disabled={!name.trim()}>
        Add
      </button>
    </form>
  );
}

function OpenGiftDialog({ name, onSave, onCancel }: { name: string; onSave: (gift: string) => Promise<void>; onCancel: () => void }) {
  const [gift, setGift] = useState("");
  return (
    <div className="lc-overlay" onClick={onCancel}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={`Open a gift for ${name}`}
        className="card lc-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        onSubmit={(e) => {
          e.preventDefault();
          if (gift.trim()) void onSave(gift.trim());
        }}
      >
        <h2>🎁 Opening a gift for {name}</h2>
        <label htmlFor="lc-gift">What's inside?</label>
        <input id="lc-gift" autoFocus autoComplete="off" maxLength={100} placeholder="e.g. Bluetooth speaker" value={gift} onChange={(e) => setGift(e.target.value)} />
        <div className="inline">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={!gift.trim()}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

/** The guests' link and its QR code, for the Host to show or send. */
function InviteDialog({ gameId, onClose }: { gameId: string; onClose: () => void }) {
  const url = `${window.location.origin}/games/${gameId}`;
  const qr = useMemo(() => `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(url, { border: 2 }))}`, [url]);
  const [copied, setCopied] = useState(false);
  return (
    <div className="lc-overlay" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-label="Invite guests" className="card lc-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Invite guests</h2>
        <img src={qr} alt="QR code to join this Game" width={220} height={220} />
        <p className="select-all">{url}</p>
        <div className="inline">
          {navigator.clipboard && (
            <button
              className="secondary"
              onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true))}
            >
              {copied ? "Copied!" : "Copy link"}
            </button>
          )}
          <button onClick={onClose}>Done</button>
        </div>
      </section>
    </div>
  );
}
