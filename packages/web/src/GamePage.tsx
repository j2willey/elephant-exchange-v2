import { MyName, RenameButton } from "./Rename.js";
import { StaffMark, useStaff } from "./Cohosts.js";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router";
import type { Command } from "@elephant/rules";
import type { CommandResult, GameView, Post, SharedGame, Viewer } from "./api.js";
import { useApi } from "./ApiContext.js";
import { Countdown } from "./Countdown.js";
import { LaptopConsole } from "./LaptopConsole.js";
import { Composer, Feed, PostPhoto, useFeed } from "./Feed.js";
import { SignInForm, useSignedIn } from "./SignIn.js";
import { ThemeLogo, useTheme } from "./theme.js";
import { useLiveGame } from "./useLiveGame.js";
import { RosterPaste } from "./RosterPaste.js";
import { ScreenSwitch } from "./WatchScreen.js";
import { VotePanel } from "./Vote.js";
import { FeedbackCard } from "./Feedback.js";

/** `gameId`: the Game to show, when it isn't the one in the address (the front page's sample phone). */
export function GamePage({ gameId }: { gameId?: string } = {}) {
  const api = useApi();
  const { id: inAddress = "" } = useParams();
  const id = gameId ?? inAddress;
  const [game, accept, feedChanges, staffChanges] = useLiveGame(id);
  const staffRole = useStaff(game, staffChanges);
  const [error, setError] = useState<string | null>(null);
  const stars = useStars(id);
  const [posts, reloadFeed] = useFeed(id, feedChanges);
  const wide = useWideScreen();
  useTheme(game && game !== "loading" ? game.theme : undefined);

  if (game === "loading") return <p className="muted">Loading…</p>;
  if (!game) return <p className="error">There's no Game at this link. Check it with your Host.</p>;

  const runs = game.role !== null;
  const joinOffered = !game.me && game.rosterMode === "self" && game.phase !== "ended";
  const nameOf = (playerId: string) => game.players.find((p) => p.id === playerId)?.name ?? "?";

  async function send(command: Command) {
    if (game === "loading" || !game) return;
    const result = await api.command(game.id, command);
    if (result.ok) {
      accept(result.game);
      setError(null);
    } else {
      setError(plainWords(result));
    }
  }

  const players = (
    <section className="card">
      <h2>Players</h2>
      {game.players.length === 0 ? (
        <p className="muted">No players yet.</p>
      ) : (
        <ol className="roster" aria-label="Players">
          {game.players.map((p) => (
            <li key={p.id}>
              <span data-name>{p.name}</span> <StaffMark role={staffRole(p.id)} />
              {runs && <RenameButton gameId={game.id} who={{ playerId: p.id }} name={p.name} />}
              {runs && game.phase === "setup" && (
                <button className="link" aria-label={`Remove ${p.name}`} onClick={() => send({ type: "RemovePlayer", playerId: p.id })}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      {runs && game.phase !== "ended" && <AddPlayer onAdd={(name) => send({ type: "AddPlayer", playerId: crypto.randomUUID(), name })} />}
      {runs && game.phase === "setup" && <RosterPaste gameId={game.id} roster={game.players.map((p) => p.name)} onAdd={(name) => send({ type: "AddPlayer", playerId: crypto.randomUUID(), name })} />}
      {runs && game.phase === "setup" && (
        <>
          <button disabled={game.players.length < 2} onClick={() => send({ type: "StartGame" })}>
            Start game
          </button>
          {game.players.length < 2 && <p className="muted hint">Add at least 2 players to start.</p>}
        </>
      )}
    </section>
  );

  const status =
    game.phase === "ended" ? (
    <section className="card">
      <h2>Game over</h2>
      <p className="muted">Here's who went home with what.</p>
    </section>
  ) : (
    game.phase !== "setup" && (
      <section className="card" aria-live="polite">
        {game.phase === "finalRound" && <h2>Final Round</h2>}
        <p>
          Up now: <strong>{game.active.map(nameOf).join(", ") || "nobody"}</strong>
        </p>
        <p>
          On deck:{" "}
          {game.onDeck.length === 0 ? (
            <strong>nobody</strong>
          ) : (
            game.onDeck.map((playerId, i) => (
              <span key={playerId}>
                {i > 0 && ", "}
                <strong>{nameOf(playerId)}</strong>
                {runs && (
                  <>
                    {" "}
                    <StaffMark role={staffRole(playerId)} />
                  </>
                )}
              </span>
            ))
          )}
        </p>
        {game.phase === "finalRound" && (
          <p className="muted">
            {game.leftoverGifts} unopened {game.leftoverGifts === 1 ? "gift" : "gifts"} left
          </p>
        )}
        {runs && (
          <button className="secondary" onClick={() => send({ type: "Undo" })}>
            Undo last pick
          </button>
        )}
      </section>
    )
  );

  // Someone who doesn't run the Game is on their phone: one panel at a time, picked from a tab bar.
  if (!runs) {
    return <GuestView game={game} accept={accept} posts={posts} reloadFeed={reloadFeed} stars={stars} joinOffered={joinOffered} players={players} />;
  }

  // A Host on a laptop gets v1's two-column console; on a phone, the single column below.
  if (wide) {
    return (
      <LaptopConsole
        game={game}
        send={send}
        error={error}
        accept={accept}
        posts={posts}
        reloadFeed={reloadFeed}
        staffRole={staffRole}
        resetTimer={async (playerId) => {
          const next = await api.resetTimer(game.id, playerId);
          if (next) accept(next);
        }}
        joinPanel={game.me ? <p className="you">You're playing as {nameOf(game.me.playerId)}</p> : joinOffered && <JoinPanel gameId={game.id} onJoined={accept} />}
        finalRoundPanel={game.phase === "playing" && game.active.length === 0 && game.gifts.length > 0 && <FinalRoundPanel game={game} send={send} />}
      />
    );
  }

  return (
    <div className="stack">
      <section className="card">
        <ThemeLogo theme={game.theme} />
        <p className="eyebrow">Host console</p>
        <h2>{game.name}</h2>
        <Settings game={game} />
        <nav className="console-links" aria-label="This Game">
          {/* A new tab, to drag onto the TV; it's read-only, for everyone to watch. */}
          <a href={`/games/${game.id}/screen`} target="_blank" rel="noopener">
            📺 Open the scoreboard
          </a>
          <ScreenSwitch game={game} />
          {/* What the QR code opens: guests follow along and join from it. Copy it to send ahead of time. */}
          <span className="inline">
            <Link to={`/games/${game.id}`}>🔗 Link for guests</Link>
            <CopyLink path={`/games/${game.id}`} />
          </span>
          <Link to={`/games/${game.id}/settings`}>⚙ Settings</Link>
          {game.role === "host" && <Link to={`/games/${game.id}/cohosts`}>🛡 Co-hosts</Link>}
          {/* Not inside the demo view itself, which shows this console in a frame. */}
          {game.demo && window.self === window.top && <Link to={`/games/${game.id}/demo`}>🖥 Demo view</Link>}
        </nav>
      </section>

      {game.me ? (
        <p className="card you">You're playing as {nameOf(game.me.playerId)}</p>
      ) : (
        joinOffered && <JoinPanel gameId={game.id} onJoined={accept} />
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {game.phase === "setup" && players}

      {status}

      {runs &&
        (game.phase === "playing" || game.phase === "finalRound") &&
        game.active.map((playerId) => (
          <Turn
            key={playerId}
            game={game}
            playerId={playerId}
            staff={staffRole(playerId)}
            send={send}
            resetTimer={async () => {
              const next = await api.resetTimer(game.id, playerId);
              if (next) accept(next);
            }}
          />
        ))}

      {runs && game.phase === "playing" && game.active.length === 0 && game.gifts.length > 0 && (
        <FinalRoundPanel game={game} send={send} />
      )}

      {game.phase === "ended" && <VotePanel game={game} accept={accept} />}
      {game.phase === "ended" && <FeedbackCard game={game} />}

      {game.gifts.length > 0 && (
        <Gifts
          game={game}
          stars={stars}
          posts={posts}
          onEdit={runs ? (giftId, { name, description }) => send({ type: "DescribeGift", giftId, name, description }) : undefined}
        />
      )}

      <Feed game={game} posts={posts} reload={reloadFeed} offerSignIn={!joinOffered} />


      {game.phase !== "setup" && players}
    </div>
  );
}

type GuestTab = "gifts" | "you" | "feed" | "post";
const guestTabs: { id: GuestTab; icon: string; label: string }[] = [
  { id: "gifts", icon: "🎁", label: "Gifts" },
  { id: "you", icon: "👤", label: "You" },
  { id: "feed", icon: "💬", label: "Feed" },
  { id: "post", icon: "📷", label: "Post" },
];

/**
 * A guest's phone (anyone who doesn't run the Game): who's up in a bar pinned to the top, the Gifts first, and a tab
 * bar, always in reach at the bottom, for themselves, the Feed and posting. The Feed's newest Post is at the top.
 */
function GuestView({
  game,
  accept,
  posts,
  reloadFeed,
  stars,
  joinOffered,
  players,
}: {
  game: GameView;
  accept: (game: SharedGame | null, viewer?: Partial<Viewer>) => void;
  posts: Post[];
  reloadFeed: () => void;
  stars: Stars;
  joinOffered: boolean;
  players: ReactNode;
}) {
  const [tab, setTab] = useState<GuestTab>("gifts");
  // When the Game ends, everyone is wanted on the Gifts, where the Worst Gift Vote happens.
  useEffect(() => {
    if (game.phase === "ended") setTab("gifts");
  }, [game.phase]);
  const myName = game.me && game.players.find((p) => p.id === game.me!.playerId)?.name;
  const myId = game.me?.playerId;
  const myTurn = myId !== undefined && game.active.includes(myId);
  const onDeck = myId !== undefined && game.onDeck.includes(myId);
  const holding = myId !== undefined ? game.gifts.find((g) => g.holderId === myId) : undefined;

  return (
    <div className="guest">
      <StatusBar game={game} mine={myTurn} />
      <header className="guest-head">
        <ThemeLogo theme={game.theme} />
        <h2>{game.name}</h2>
      </header>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="stack">
        {tab === "gifts" && (
          <>
            {game.phase === "ended" && <VotePanel game={game} accept={accept} />}
            {game.phase === "ended" && <FeedbackCard game={game} />}
            {joinOffered && (
              <button className="secondary" onClick={() => setTab("you")}>
                Playing? Join the Game
              </button>
            )}
            {game.gifts.length > 0 ? (
              <Gifts game={game} stars={stars} posts={posts} />
            ) : (
              <p className="card muted">No Gifts opened yet. They'll show up here as they're opened.</p>
            )}
          </>
        )}
        {tab === "you" && (
          <>
            {myTurn && <p className="card your-turn">It's your turn!</p>}
            {myName ? (
              <section className="card you" aria-label="You">
                <p>You're playing as {myName}</p>
                <MyName game={game} onChanged={(name) => accept(null, { myName: { name, locked: false } })} />
                {onDeck && <p>You're on deck: get ready!</p>}
                {holding && (
                  <p>You're holding: {holding.name}</p>
                )}
              </section>
            ) : joinOffered ? (
              <JoinPanel gameId={game.id} onJoined={accept} />
            ) : (
              <p className="card muted">You're following along. The Host enters the Players for this Game.</p>
            )}
            {!game.me && game.myName?.name && (
              <section className="card" aria-label="Your name">
                <p>You're posting as {game.myName.name}</p>
                <MyName game={game} onChanged={(name) => { accept(null, { myName: { name, locked: false } }); reloadFeed(); }} />
              </section>
            )}
            {players}
          </>
        )}
        {tab === "feed" && (
          <>
            {game.phase !== "ended" && (
              <button className="secondary" onClick={() => setTab("post")}>
                Write a Post
              </button>
            )}
            <Feed game={game} posts={posts} reload={reloadFeed} offerSignIn={false} composer={false} />
          </>
        )}
        {tab === "post" && (
          <section className="card">
            <h2>Post</h2>
            {game.phase === "ended" ? (
              <p className="muted">The Game is over, so posting has closed.</p>
            ) : (
              <Composer
                game={game}
                offerSignIn
                onPosted={() => {
                  reloadFeed();
                  setTab("feed");
                }}
              />
            )}
          </section>
        )}
      </div>

      <nav className="tabbar" role="tablist" aria-label="Game">
        {guestTabs.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            className={t.id === "you" && myTurn ? "alert" : undefined}
            onClick={() => {
              setTab(t.id);
              window.scrollTo?.(0, 0);
            }}
          >
            <span aria-hidden="true">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

/**
 * Who's up and who's on deck, pinned to the top of a guest's phone. One row when 1 or 2 take a turn at once;
 * with more, Up now and On deck get a row each so the names have room.
 */
function StatusBar({ game, mine }: { game: GameView; mine: boolean }) {
  const names = (ids: string[]) => ids.map((id) => game.players.find((p) => p.id === id)?.name ?? "?").join(", ") || "nobody";
  const final = game.phase === "finalRound" ? "Final Round · " : "";
  let body: ReactNode;
  if (game.phase === "setup") {
    body = (
      <p>
        Waiting for the Host to start · {game.players.length} {game.players.length === 1 ? "player" : "players"} so far
      </p>
    );
  } else if (game.phase === "ended") {
    body = <p>Game over</p>;
  } else if (game.settings.activeSlots <= 2) {
    body = (
      <p>
        {final}Up now: <strong>{names(game.active)}</strong> · On deck: <strong>{names(game.onDeck)}</strong>
      </p>
    );
  } else {
    body = (
      <>
        <p>
          {final}Up now: <strong>{names(game.active)}</strong>
        </p>
        <p>
          On deck: <strong>{names(game.onDeck)}</strong>
        </p>
      </>
    );
  }
  return (
    <section role="status" aria-label="Who's up" className={mine ? "statusbar mine" : "statusbar"}>
      {body}
    </section>
  );
}

/**
 * In a Self sign-up Game: sign in if need be (the emailed link comes back here), then join as a Player by name.
 * Joining after the start is fine: they're a Late Arrival, waiting to be called like anyone not yet called.
 */
function JoinPanel({ gameId, onJoined }: { gameId: string; onJoined: (game: SharedGame, viewer: Partial<Viewer>) => void }) {
  const api = useApi();
  const { pathname } = useLocation();
  const signedIn = useSignedIn();
  const [name, setName] = useState(() => api.guestName());
  const [error, setError] = useState<string | null>(null);

  async function join(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const result = await api.join(gameId, trimmed);
    if (result.ok) {
      api.setGuestName(trimmed);
      onJoined(result.game, { me: result.me });
    }
    else setError(result.message.endsWith(".") ? result.message : `${result.message}.`);
  }

  return (
    <section className="card" aria-label="Play in this Game">
      {signedIn === "loading" ? (
        <p className="muted">Loading…</p>
      ) : !signedIn ? (
        <SignInForm next={pathname} heading="Playing? Sign in first" />
      ) : (
        <form className="stack" onSubmit={join}>
          <h2>Playing in this Game?</h2>
          <label htmlFor="my-name">Your name, as everyone will see it</label>
          <input id="my-name" autoComplete="given-name" autoCapitalize="words" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={!name.trim()}>
            Join as a Player
          </button>
        </form>
      )}
    </section>
  );
}

/** Offered once every Turn is done. The Final Round isn't mentioned before then. */
function FinalRoundPanel({ game, send }: { game: GameView; send: (c: Command) => Promise<void> }) {
  const holders = game.players.filter((p) => game.gifts.some((g) => g.holderId === p.id)).length;
  const [finalists, setFinalists] = useState(String(holders));
  const [leftovers, setLeftovers] = useState("0");

  function submit(e: FormEvent) {
    e.preventDefault();
    void send({ type: "StartFinalRound", finalists: Number(finalists), leftoverGifts: Number(leftovers) });
  }

  return (
    <section className="card" aria-label="Final Round">
      <form className="stack" onSubmit={submit}>
        <h2>Ready for the Final Round?</h2>
        <p className="muted">Everyone has a Gift. Players get a last chance, one at a time, in the order they were drawn.</p>
        <label htmlFor="finalists">How many Players get a final chance?</label>
        <input id="finalists" type="number" inputMode="numeric" min={0} max={holders} required value={finalists} onChange={(e) => setFinalists(e.target.value)} />
        <label htmlFor="leftovers">How many unopened Gifts are left on the table?</label>
        <input id="leftovers" type="number" inputMode="numeric" min={0} max={200} required value={leftovers} onChange={(e) => setLeftovers(e.target.value)} />
        <button type="submit">Start the Final Round</button>
      </form>
    </section>
  );
}

/** Whether the screen is laptop-wide (the two-column Host console); follows the window as it's resized. */
const WIDE = "(min-width: 1000px)";
function useWideScreen(): boolean {
  const [wide, setWide] = useState(() => (typeof window.matchMedia === "function" ? window.matchMedia(WIDE).matches : false));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(WIDE);
    const changed = () => setWide(query.matches);
    query.addEventListener?.("change", changed);
    return () => query.removeEventListener?.("change", changed);
  }, []);
  return wide;
}

/** Copies a page of this app's full address, to paste into an email or a text. */
function CopyLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  if (typeof navigator === "undefined" || !navigator.clipboard) return null;
  return (
    <button
      className="link"
      onClick={() => {
        void navigator.clipboard.writeText(`${window.location.origin}${path}`).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

/** The rules' own messages are already plain; a couple read better reworded for a Host mid-party. */
function plainWords(result: Extract<CommandResult, { ok: false }>): string {
  switch (result.code) {
    case "NoTakeBacks":
      return "No take-backs: a Player can't steal back the Gift that was just taken from them.";
    case "GiftNotOpened":
      return "That Gift hasn't been opened yet.";
    default:
      return result.message.endsWith(".") ? result.message : `${result.message}.`;
  }
}

/** One active Player's Turn: open a Gift, steal one, or skip them. In the Final Round: keep, steal, or take. */
function Turn({
  game,
  playerId,
  staff,
  send,
  resetTimer,
}: {
  game: GameView;
  playerId: string;
  /** Set when this Player is the Host or a Co-host, who'll be busy opening: someone else enters the turn. */
  staff?: "host" | "cohost" | undefined;
  send: (c: Command) => Promise<void>;
  resetTimer: () => Promise<void>;
}) {
  const name = game.players.find((p) => p.id === playerId)?.name ?? "?";
  const [gift, setGift] = useState("");
  const holderName = (id: string | null) => game.players.find((p) => p.id === id)?.name ?? "?";
  const final = game.phase === "finalRound";
  const held = game.gifts.find((g) => g.holderId === playerId);
  const stealable = game.gifts.filter((g) => g.holderId !== null && g.holderId !== playerId && !g.frozen);
  const onTable = game.gifts.filter((g) => g.holderId === null);
  const canOpen = !final || game.leftoverGifts > 0;

  async function open(e: FormEvent) {
    e.preventDefault();
    const trimmed = gift.trim();
    if (!trimmed) return;
    setGift("");
    await send({ type: "OpenGift", playerId, giftId: crypto.randomUUID(), name: trimmed });
  }

  return (
    <section className="card turn" aria-label={final ? `${name}'s final turn` : `${name}'s turn`}>
      <div className="turn-head">
        <h2>{final ? `${name}'s final turn` : `${name}'s turn`}</h2>
        <Countdown game={game} playerId={playerId} name={name} />
      </div>
      {staff && (
        <p className="staff-note">
          <StaffMark role={staff} /> {name} is {staff === "host" ? "the Host" : "a Co-host"}: enter this turn for them.
        </p>
      )}
      {final && held && (
        <button onClick={() => send({ type: "KeepGift", playerId })}>Keep {held.name}</button>
      )}
      {canOpen && (
        <form className="inline" onSubmit={open}>
          <label htmlFor={`gift-${playerId}`} className="visually-hidden">
            What's in {name}'s gift?
          </label>
          <input
            id={`gift-${playerId}`}
            placeholder={`What's in ${name}'s gift?`}
            autoComplete="off"
            maxLength={100}
            value={gift}
            onChange={(e) => setGift(e.target.value)}
          />
          <button type="submit" disabled={!gift.trim()}>
            Open gift
          </button>
        </form>
      )}
      {canOpen && !gift.trim() && (
        <button className="secondary" onClick={() => send({ type: "OpenGift", playerId, giftId: crypto.randomUUID(), name: "" })}>
          ⏩ Opened: name it later
        </button>
      )}
      {onTable.length > 0 && (
        <div className="steals">
          <p className="muted">On the table:</p>
          {onTable.map((g) => (
            <button key={g.id} className="secondary" onClick={() => send({ type: "TakeReturnedGift", playerId, giftId: g.id })}>
              Take {g.name}
            </button>
          ))}
        </div>
      )}
      {stealable.length > 0 && (
        <div className="steals">
          <p className="muted">Or steal:</p>
          {stealable.map((g) => (
            <button key={g.id} className="secondary" onClick={() => send({ type: "Steal", playerId, giftId: g.id })}>
              Steal {g.name} from {holderName(g.holderId)}
            </button>
          ))}
        </div>
      )}
      <div className="inline">
        {!final && (
          <button className="link" onClick={() => send({ type: "Skip", playerId })}>
            Skip {name}
          </button>
        )}
        {game.clock.turnSeconds > 0 && (
          <button className="link" aria-label={`Reset ${name}'s timer`} onClick={() => void resetTimer()}>
            Reset timer
          </button>
        )}
      </div>
    </section>
  );
}

/** This device's Stars for a Game: kept on the device, never sent anywhere. */
function useStars(gameId: string): Stars {
  const api = useApi();
  const [starred, setStarred] = useState(() => new Set(api.stars(gameId)));
  return {
    starred,
    toggle(giftId) {
      const next = new Set(starred);
      if (!next.delete(giftId)) next.add(giftId);
      setStarred(next);
      api.setStars(gameId, [...next]);
    },
  };
}

interface Stars {
  starred: ReadonlySet<string>;
  toggle: (giftId: string) => void;
}

/**
 * The Gifts in the order they were opened; with `stars`, Starred ones come first and each has a Star button.
 * With `posts`, each Gift shows the Posts about it. With `onEdit` (for the Host), each Gift can be corrected in place.
 */
export function Gifts({
  game,
  stars,
  posts = [],
  onEdit,
}: {
  game: Pick<GameView, "gifts" | "players">;
  stars?: Stars;
  posts?: Post[];
  onEdit?: ((giftId: string, gift: { name: string; description: string }) => Promise<void>) | undefined;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const holderName = (id: string | null) => (id === null ? "on the table" : (game.players.find((p) => p.id === id)?.name ?? "?"));
  const isStarred = (giftId: string) => stars?.starred.has(giftId) ?? false;
  const shown = [...game.gifts.filter((g) => isStarred(g.id)), ...game.gifts.filter((g) => !isStarred(g.id))];
  return (
    <section className="card">
      <h2>Gifts</h2>
      <ul className="gifts" aria-label="Gifts">
        {shown.map((g) => (
          <li key={g.id} aria-label={g.name} className={isStarred(g.id) ? "starred" : undefined}>
            {stars && (
              <button className="star" aria-label={`Star ${g.name}`} aria-pressed={isStarred(g.id)} onClick={() => stars.toggle(g.id)}>
                {isStarred(g.id) ? "★" : "☆"}
              </button>
            )}
            <span className="gift-name">
              <strong>{g.name}</strong> — {holderName(g.holderId)}
              {!g.named && !onEdit && <span className="muted"> (details coming)</span>}
              {onEdit && editing !== g.id && (g.named ? (
                <button className="link" aria-label={`Edit ${g.name}`} onClick={() => setEditing(g.id)}>
                  Edit
                </button>
              ) : (
                <button className="needs-name" aria-label={`What is ${g.name}?`} onClick={() => setEditing(g.id)}>
                  ✏️ What is it?
                </button>
              ))}
              {g.description && editing !== g.id && <span className="gift-desc">{g.description}</span>}
              {onEdit && editing === g.id && (
                <EditGift
                  gift={g.named ? g : { ...g, name: "" }}
                  label={`Edit ${g.name}`}
                  onCancel={() => setEditing(null)}
                  onSave={async (change) => {
                    setEditing(null);
                    await onEdit(g.id, change);
                  }}
                />
              )}
              {posts
                .filter((p) => p.giftId === g.id && p.status === "visible")
                .map((p) => (
                  <span key={p.id} className="gift-post">
                    {p.author}
                    {p.text && `: ${p.text}`}
                    <PostPhoto post={p} className="gift-photo" />
                  </span>
                ))}
            </span>
            <span className="muted">
              {g.steals > 0 && `${g.steals} ${g.steals === 1 ? "steal" : "steals"}`}
              {g.frozen && <span className="badge">Frozen</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The Host's correction to a Gift's name, or the details they add, inline on the phone. */
function EditGift({
  gift,
  label,
  onSave,
  onCancel,
}: {
  gift: { id: string; name: string; description: string };
  label: string;
  onSave: (gift: { name: string; description: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(gift.name);
  const [description, setDescription] = useState(gift.description);
  return (
    <form
      className="stack edit-gift"
      aria-label={label}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) void onSave({ name: name.trim(), description: description.trim() });
      }}
    >
      <label htmlFor={`gift-name-${gift.id}`}>What's inside?</label>
      <input id={`gift-name-${gift.id}`} autoFocus autoComplete="off" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor={`gift-desc-${gift.id}`}>Details (optional)</label>
      <input id={`gift-desc-${gift.id}`} autoComplete="off" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="inline">
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={!name.trim()}>
          Save
        </button>
      </div>
    </form>
  );
}

function Settings({ game }: { game: GameView }) {
  const { activeSlots, maxSteals } = game.settings;
  return (
    <p className="muted">
      {activeSlots === 1 ? "1 player takes a turn at once" : `${activeSlots} players take a turn at once`} ·{" "}
      {maxSteals === 0 ? "no steals" : `Gifts are frozen after ${maxSteals} ${maxSteals === 1 ? "steal" : "steals"}`} ·{" "}
      {game.rosterMode === "self" ? "Players can sign up on their phones" : "the Host enters the Players"}
    </p>
  );
}

/** Quick entry: the box clears and keeps focus, so the Host can type the next name straight away. */
function AddPlayer({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setName("");
    input.current?.focus();
    await onAdd(trimmed);
  }

  return (
    <form className="inline" onSubmit={submit}>
      <label htmlFor="player-name" className="visually-hidden">
        Player's name
      </label>
      <input
        id="player-name"
        ref={input}
        placeholder="Player's name"
        autoComplete="off"
        autoCapitalize="words"
        maxLength={100}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" disabled={!name.trim()}>
        Add player
      </button>
    </form>
  );
}
