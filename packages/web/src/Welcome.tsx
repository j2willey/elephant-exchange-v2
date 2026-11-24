/**
 * The welcome a guest gets on a Game's link (the QR code, the Invite link, a forwarded invitation): who they are,
 * whether they brought a gift, or just watch. Who someone is in a Game is their email, proved by the emailed link
 * (ADR 0007), so posting and playing wait for it; watching needs nothing.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import type { GameView, SharedGame, Viewer } from "./api.js";
import { useApi } from "./ApiContext.js";
import { ThemeLogo } from "./theme.js";

type Accept = (game: SharedGame | null, viewer?: Partial<Viewer>) => void;

/** What the emailed link carries back: whether they're playing or a Guest, and their Name. */
export const welcomeReturn = (gameId: string, as: "player" | "guest", name: string) => {
  const path = `/games/${encodeURIComponent(gameId)}?as=${as}`;
  const withName = `${path}&name=${encodeURIComponent(name)}`;
  return withName.length <= 200 ? withName : path; // the server refuses longer; they'd be asked their Name again
};

/** "Just watch", remembered for this Game on this phone so the welcome doesn't come back on every visit. */
export function useWatching(gameId: string): [boolean, () => void] {
  const key = `ee-watching-${gameId}`;
  const [watching, setWatching] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  return [
    watching,
    () => {
      setWatching(true);
      try {
        localStorage.setItem(key, "1");
      } catch {
        // private browsing: the welcome comes back on reload, which is fine
      }
    },
  ];
}

/** Whether this person has said who they are in the Game yet: a Player, or a Guest with a Name. */
export const knownIn = (game: GameView) => Boolean(game.me || game.myName?.name || game.myName?.pending);

/** The When & where line, if the Host wrote one. */
export function WhenWhere({ game }: { game: GameView }) {
  return game.whenWhere ? <p className="when-where">📍 {game.whenWhere}</p> : null;
}

/** The whole first screen: the Game, the form, and Just watch. */
export function Welcome({ game, signedIn, accept, onWatch }: { game: GameView; signedIn: boolean; accept: Accept; onWatch: () => void }) {
  return (
    <div className="guest welcome stack">
      <header className="guest-head">
        <ThemeLogo theme={game.theme} />
        <h2>{game.name}</h2>
        {game.tagline && <p className="game-tagline">{game.tagline}</p>}
        <WhenWhere game={game} />
      </header>
      <p className="card welcome-intro">
        Welcome! Follow along with the gift swap here: who's up, every Gift that's opened, and the 💬 Chat.
      </p>
      <WelcomeForm game={game} signedIn={signedIn} accept={accept} onWatch={onWatch} />
      <section className="card stack" aria-label="Just watch">
        <button type="button" className="secondary" onClick={onWatch}>
          Just watch
        </button>
        <p className="muted hint">No email needed to watch. You can join from the 👤 You tab any time.</p>
      </section>
    </div>
  );
}

/**
 * Name, email and "I brought a gift". Signed out, it sends the sign-in link, which comes back to the Game and
 * finishes there (useWelcomeReturn). Signed in already, it joins or sets their Name at once.
 */
export function WelcomeForm({ game, signedIn, accept, onWatch }: { game: GameView; signedIn: boolean; accept: Accept; onWatch?: () => void }) {
  const api = useApi();
  const ids = useId();
  const [name, setName] = useState(() => api.guestName());
  const [email, setEmail] = useState("");
  const [gift, setGift] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const selfSignUp = game.rosterMode === "self";
  const started = game.phase !== "setup";

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const as = selfSignUp && gift ? "player" : "guest";
    setError(null);
    setStatus("sending");
    if (signedIn) {
      const failed = await finishJoining(api, game.id, as, trimmed, accept);
      setStatus("idle");
      if (failed) setError(failed);
      return;
    }
    const sent = await api.requestLink(email, welcomeReturn(game.id, as, trimmed)).catch(() => "failed" as const);
    if (sent === "sent") {
      api.setGuestName(trimmed);
      setStatus("sent");
      return;
    }
    setStatus("idle");
    setError(
      sent === "tooMany"
        ? "Too many sign-in links have been asked for. Please wait a few minutes and try again."
        : sent === "invalidEmail"
          ? "That doesn't look like an email address."
          : "Something went wrong sending the link. Please try again.",
    );
  }

  if (status === "sent") {
    return (
      <section className="card" aria-live="polite" aria-label="Check your email">
        <h2>Check your email</h2>
        <p>
          We sent a link to <strong>{email.trim()}</strong>. Tap it to come back here as <strong>{name.trim()}</strong>
          {selfSignUp && gift ? ", playing" : ""}.
        </p>
        <p className="muted">
          Not there in a minute or two? Check your <strong>spam or junk folder</strong> for an email from Elephant
          Exchange.
        </p>
        <div className="inline">
          {onWatch && (
            <button type="button" onClick={onWatch}>
              Watch while you wait
            </button>
          )}
          <button type="button" className="secondary" onClick={() => setStatus("idle")}>
            Wrong address, or send it again
          </button>
        </div>
      </section>
    );
  }

  return (
    <form className="card stack" onSubmit={submit} aria-label="Join this Game">
      <h2>{signedIn ? "Who are you?" : "Join in"}</h2>
      <label htmlFor={`${ids}-name`}>Your name, as everyone will see it</label>
      <input
        id={`${ids}-name`}
        autoComplete="given-name"
        autoCapitalize="words"
        maxLength={100}
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {!signedIn && (
        <>
          <label htmlFor={`${ids}-email`}>Email address</label>
          <input
            id={`${ids}-email`}
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </>
      )}
      {selfSignUp ? (
        <label className="check">
          <input type="checkbox" checked={gift} onChange={(e) => setGift(e.target.checked)} />
          I brought a gift, and I'm playing
        </label>
      ) : (
        <p className="muted hint">The Host adds the Players for this Game. Brought a gift? Make sure the Host has your name.</p>
      )}
      <p className="muted hint">
        {selfSignUp && gift
          ? started
            ? "You'll join the Players not called yet."
            : "You'll be on the Players list, waiting for the Host to start."
          : "You can chat and post photos as a guest."}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={!name.trim() || status === "sending"}>
        {signedIn ? (selfSignUp && gift ? "Join as a Player" : "Join as a guest") : "Email me a link to join"}
      </button>
      {!signedIn && (
        <p className="muted hint">
          No password: we email you a link, so only you can post or play as you. Hosting this Game? Sign in here too, to run
          it from this device.
        </p>
      )}
    </form>
  );
}

/** Joins as a Player or sets a Guest's Name; says what went wrong, if anything. */
async function finishJoining(api: ReturnType<typeof useApi>, gameId: string, as: "player" | "guest", name: string, accept: Accept): Promise<string | null> {
  if (as === "player") {
    const result = await api.join(gameId, name);
    if (!result.ok) return result.message.endsWith(".") ? result.message : `${result.message}.`;
    api.setGuestName(name);
    // Under Approve names they play as "New player" until it's approved; their phone says so.
    const shown = result.game.players.find((p) => p.id === result.me.playerId)?.name ?? null;
    accept(result.game, { me: result.me, myName: { name: shown, locked: false, pending: shown === name ? null : name } });
    return null;
  }
  const changed = await api.changeMyName(gameId, name);
  if (changed === "failed") return "That didn't work. Please try again.";
  if (changed === "locked") return "Your Host set your name.";
  api.setGuestName(name);
  accept(null, { myName: changed === "ok" ? { name, locked: false, pending: null } : { name: null, locked: false, pending: name } });
  return null;
}

/**
 * Back from the emailed link, signed in: `?as=player|guest&name=…` says what they asked for on the welcome screen.
 * Done once, then the address is tidied. A Host or Co-host gets the console, so there's nothing to do for them;
 * someone who already has a place in the Game keeps it. True while that's still under way, so the welcome
 * screen doesn't flash up in the meantime.
 */
export function useWelcomeReturn(game: GameView | null | "loading", signedIn: boolean | "loading", accept: Accept): boolean {
  const api = useApi();
  const { search, pathname } = useLocation();
  const navigate = useNavigate();
  const done = useRef(false);
  const [finishing, setFinishing] = useState(() => new URLSearchParams(search).has("as"));
  useEffect(() => {
    if (done.current || game === "loading" || signedIn === "loading") return;
    const params = new URLSearchParams(search);
    const as = params.get("as");
    if (!game || signedIn !== true || (as !== "player" && as !== "guest")) return setFinishing(false);
    done.current = true;
    const name = params.get("name")?.trim();
    navigate(pathname, { replace: true });
    if (!name || game.role !== null || knownIn(game)) return setFinishing(false);
    void finishJoining(api, game.id, as === "player" && game.rosterMode === "self" ? "player" : "guest", name, accept).finally(() =>
      setFinishing(false),
    );
  }, [game, signedIn, search, pathname, navigate, api, accept]);
  return finishing;
}

/**
 * The invitation a Host pastes into their own email or team chat: the Game, When & where and its link. Sent from the
 * Host's own address, it reaches people far better than an email from the app would (docs/invite-plan.md).
 */
export function invitationText(game: Pick<GameView, "id" | "name" | "tagline" | "whenWhere" | "rosterMode">, origin: string): string {
  const lines = [`You're invited: ${game.name}`];
  if (game.tagline) lines.push(game.tagline);
  if (game.whenWhere) lines.push(game.whenWhere);
  lines.push(
    "",
    "Bring a wrapped gift for the White Elephant swap.",
    game.rosterMode === "self"
      ? "You can sign up as a Player ahead of time at the link below. On the day, it's there to follow along on your phone if you like: every gift, who's up next, and the chat."
      : "On the day, follow along on your phone if you like: every gift, who's up next, and the chat.",
    `${origin}/games/${game.id}`,
  );
  return lines.join("\n");
}

/** "Copy invitation": the invitation text on the clipboard. */
export function CopyInvitation({ game, className = "secondary" }: { game: GameView; className?: string }) {
  const [copied, setCopied] = useState(false);
  if (typeof navigator === "undefined" || !navigator.clipboard) return null;
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        void navigator.clipboard.writeText(invitationText(game, window.location.origin)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? "Copied!" : "Copy invitation"}
    </button>
  );
}
