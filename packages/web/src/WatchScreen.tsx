import { pitchOf } from "./Pitch.js";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useParams } from "react-router";
import { renderSVG } from "uqr";
import type { GameView, Post, ScreenMode } from "./api.js";
import { useApi } from "./ApiContext.js";
import { Countdown } from "./Countdown.js";
import { PostPhoto, QuoteCard, Reactions, useFeed } from "./Feed.js";
import { ThemeLogo, useTheme } from "./theme.js";
import { useLiveGame } from "./useLiveGame.js";

/** For a projector or TV at the party, laid out as v1's scoreboard: who's up, the Gifts, and how to join. It only watches. */
export function WatchScreen() {
  const { id = "" } = useParams();
  const [game, , feedChanges] = useLiveGame(id);
  const [posts] = useFeed(id, feedChanges);
  useTheme(game && game !== "loading" ? game.theme : undefined);

  if (game === "loading") return <p className="muted">Loading…</p>;
  if (!game) return <p className="error">There's no Game at this link. Check it with your Host.</p>;

  const nameOf = (playerId: string) => game.players.find((p) => p.id === playerId)?.name ?? "?";
  const players = game.players.length;

  return (
    <div className="screen">
      <header className="screen-banner" role="banner">
        <ThemeLogo theme={game.theme} className="screen-logo" />
        <h2>{game.name}</h2>
      </header>
      {game.screen === "rules" ? (
        <Rules game={game} />
      ) : game.screen === "qr" ? (
        <Join gameId={game.id} big />
      ) : game.screen === "catalog" ? (
        <Catalog game={game} posts={posts} />
      ) : (
        <div className="screen-body">
          <div className="screen-main">
            {game.phase === "ended" ? (
              <EndOfGame game={game} posts={posts} />
            ) : game.phase === "setup" ? (
              <section className="card now">
                <p className="big">Waiting for the Host to start</p>
                <p className="muted">
                  {players} {players === 1 ? "player" : "players"} so far
                </p>
              </section>
            ) : (
              <div className="screen-top">
                <section className="card now" aria-live="polite">
                  {game.phase === "finalRound" && <h2 className="label">Final Round</h2>}
                  <p className="label">Up now</p>
                  <p className="big">{game.active.map(nameOf).join(", ") || "—"}</p>
                  {game.active.map((playerId) => (
                    <Countdown key={playerId} game={game} playerId={playerId} name={nameOf(playerId)} />
                  ))}
                </section>
                <section className="card">
                  <p className="label">On deck</p>
                  <p className="medium">{game.onDeck.map(nameOf).join(", ") || "—"}</p>
                </section>
              </div>
            )}
            {game.gifts.length > 0 && !(game.phase === "ended" && showsVote(game)) && <GiftBoard game={game} posts={posts} />}
          </div>
          <aside className="screen-side">
            <LatestPosts game={game} posts={posts} />
            <Join gameId={game.id} />
          </aside>
        </div>
      )}
    </div>
  );
}

type Gift = GameView["gifts"][number];

const screenModes: { mode: ScreenMode; label: string }[] = [
  { mode: "gifts", label: "Gifts" },
  { mode: "rules", label: "Rules" },
  { mode: "qr", label: "QR code" },
  { mode: "catalog", label: "Catalog" },
];

/**
 * For the Host's console: what the big screen shows, as v1's menu bar had it. The pressed button follows the Game, so a
 * Co-host's switch shows here too.
 */
export function ScreenSwitch({ game }: { game: GameView }) {
  const api = useApi();
  return (
    <div role="group" aria-label="Scoreboard shows" className="screen-switch">
      <span className="screen-switch-label">Scoreboard shows</span>
      {screenModes.map(({ mode, label }) => (
        <button key={mode} className="toggle" aria-pressed={game.screen === mode} onClick={() => void api.setScreen(game.id, mode)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** The house rules, read out to the room before the first name is called; the Steal limit is this Game's own. */
function Rules({ game }: { game: GameView }) {
  const { maxSteals } = game.settings;
  return (
    <section className="card rules" aria-label="How it works">
      <h2>How it works</h2>
      <ul>
        <li>
          <span aria-hidden="true">🎲</span> Names are drawn at random, so nobody knows when they're up. Watch for yours under On deck.
        </li>
        <li>
          <span aria-hidden="true">🎁</span> When you're called, open a new Gift or steal one that's already open.
        </li>
        <li>
          <span aria-hidden="true">😈</span> If your Gift is stolen, you go next: open a new one or steal another.
        </li>
        <li>
          <span aria-hidden="true">🚫</span> No take-backs: you can't steal straight back the Gift just taken from you.
        </li>
        <li>
          <span aria-hidden="true">❄</span>{" "}
          {maxSteals === 0
            ? "No steals in this Game: everyone opens a new Gift."
            : `A Gift is Frozen after ${maxSteals} ${maxSteals === 1 ? "steal" : "steals"}, and its holder keeps it.`}
        </li>
        <li>
          <span aria-hidden="true">🏁</span> At the end, the first few called may get one last chance to steal.
        </li>
        <li>
          <span aria-hidden="true">📱</span> Follow along on your phone: Star the Gifts you want, and post photos of what you open.
        </li>
      </ul>
    </section>
  );
}

/** Every Gift as a card with its Photo, holder and Steals; those with a Photo first. Scrolls itself like the board. */
function Catalog({ game, posts }: { game: GameView; posts: Post[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  useAutoScroll(scroller);
  const photoOf = (giftId: string) => posts.find((p) => p.giftId === giftId && p.status === "visible" && p.photo);
  const holderName = (id: string | null) => (id === null ? "On the table" : (game.players.find((p) => p.id === id)?.name ?? "?"));
  const gifts = [...game.gifts].sort((a, b) => Number(!photoOf(a.id)) - Number(!photoOf(b.id)) || byInterest(a, b));
  if (gifts.length === 0) {
    return (
      <section className="card now">
        <p className="big">No Gifts opened yet</p>
      </section>
    );
  }
  return (
    <div className="catalog-scroll" ref={scroller}>
      <ul className="catalog" aria-label="Catalog">
        {gifts.map((g) => {
          const photo = photoOf(g.id);
          return (
            <li key={g.id} aria-label={g.name} className={g.frozen ? "card catalog-card frozen" : "card catalog-card"}>
              {photo ? (
                <PostPhoto post={photo} className="catalog-photo" />
              ) : (
                <span className="catalog-photo catalog-none" aria-hidden="true">
                  🎁
                </span>
              )}
              <strong>{g.name}</strong>
              {g.description && <span className="gift-desc">{g.description}</span>}
              <CatalogPitch part={pitchOf(posts, g.id).find((p) => p.status === "visible")} />
              <span className="catalog-meta">
                <span>{holderName(g.holderId)}</span>
                <StealChip gift={g} maxSteals={game.settings.maxSteals} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The newest part of a Gift's Pitch, on the TV: the holder's own words, in quotes. */
function CatalogPitch({ part }: { part: Post | undefined }) {
  if (!part) return null;
  return (
    <span className="catalog-pitch">
      🎤 “{part.text}” <span className="muted">— {part.author}</span>
    </span>
  );
}

/** Still in play first, the most stolen (the ones people are fighting over) at the top; Frozen ones sink to the bottom. */
const byInterest = (a: Gift, b: Gift) => Number(a.frozen) - Number(b.frozen) || b.steals - a.steals;

/**
 * The Gifts as a table to read from across the room: each Gift with a Photo if someone posted one, who holds it,
 * and how many Steals it has left. When there are more than fit, it scrolls slowly through them and starts over.
 */
function GiftBoard({ game, posts }: { game: GameView; posts: Post[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  useAutoScroll(scroller);
  const holderName = (id: string | null) => (id === null ? "On the table" : (game.players.find((p) => p.id === id)?.name ?? "?"));
  // Posts come newest first, so this is the latest Photo of each Gift.
  const photoOf = (giftId: string) => posts.find((p) => p.giftId === giftId && p.status === "visible" && p.photo);
  const gifts = [...game.gifts].sort(byInterest);
  // Room for thumbnails only once there's a Photo to show: until then the names sit at the left edge.
  const photos = gifts.some((g) => photoOf(g.id));
  return (
    <section className={photos ? "card board with-photos" : "card board"} aria-label="Gift board">
      <div className="board-row board-head" aria-hidden="true">
        <span>Gift</span>
        <span>Holder</span>
        <span>Status</span>
      </div>
      <div className="board-scroll" ref={scroller}>
        <ul className="board-list" aria-label="Gifts">
          {gifts.map((g) => {
            const photo = photoOf(g.id);
            return (
              <li key={g.id} aria-label={g.name} className={g.frozen ? "board-row frozen" : "board-row"}>
                <span className="board-gift">
                  {photo ? <PostPhoto post={photo} className="board-photo" /> : photos && <span className="board-photo" aria-hidden="true" />}
                  <span className="board-name">
                    <strong>{g.name}</strong>
                    {g.description && <span className="gift-desc">{g.description}</span>}
                  </span>
                </span>
                <span className="board-holder">{holderName(g.holderId)}</span>
                <span>
                  <StealChip gift={g} maxSteals={game.settings.maxSteals} />
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** "1/3 steals", turning red with one Steal left; "Frozen" once it can't be stolen. */
function StealChip({ gift, maxSteals }: { gift: Gift; maxSteals: number }) {
  if (gift.frozen) {
    return (
      <span className="chip" data-state="frozen">
        ❄ Frozen
      </span>
    );
  }
  if (maxSteals === 0) return <span className="chip">No steals</span>;
  const state = gift.steals >= maxSteals - 1 ? "last" : gift.steals > 0 ? "stolen" : "fresh";
  return (
    <span className="chip" data-state={state}>
      {gift.steals}/{maxSteals} steals
    </span>
  );
}

/** How fast the board scrolls, and how long it rests at the top and the bottom. */
const SCROLL_PX_PER_SECOND = 40;
const REST_MS = 4000;
/** For anyone who's asked for less motion: a page at a time, each held long enough to read. */
const PAGE_MS = 8000;

/**
 * Scrolls a box slowly to its end whenever its content is taller than it, rests, then jumps back to the top and goes
 * again: the room sees every Gift without anyone touching the screen. Does nothing while everything fits.
 */
function useAutoScroll(box: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = box.current;
    if (!el || typeof requestAnimationFrame !== "function") return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let phase: "top" | "moving" | "bottom" = "top";
    let restUntil = performance.now() + REST_MS;
    let position = 0;
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      frame = requestAnimationFrame(step);
      const room = el.scrollHeight - el.clientHeight;
      const elapsed = now - last;
      last = now;
      if (room <= 1) {
        phase = "top";
        position = el.scrollTop = 0;
        restUntil = now + REST_MS;
        return;
      }
      if (now < restUntil) return;
      if (phase === "bottom") {
        phase = "top";
        position = el.scrollTop = 0;
        restUntil = now + REST_MS;
        return;
      }
      phase = "moving";
      if (reduced) {
        position = Math.min(room, position + el.clientHeight * 0.9);
        restUntil = now + PAGE_MS;
      } else {
        position = Math.min(room, position + (SCROLL_PX_PER_SECOND * elapsed) / 1000);
      }
      el.scrollTop = position;
      if (position >= room) {
        phase = "bottom";
        restUntil = now + (reduced ? PAGE_MS : REST_MS);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [box]);
}

/** The last word on the big screen, as v1 ended its results. */
const THANKS = "Thanks for playing! See you next year! 🐘";

const votesText = (n: number) => `${n} ${n === 1 ? "vote" : "votes"}`;

/** Whether the vote takes the place of the plain list of Gifts: it lists them itself, with counts or as a parade. */
const showsVote = (game: GameView) => game.vote.status === "closed" || (game.vote.status === "open" && game.vote.display !== "hidden");

/** After the last Pick: "Game over", then the Worst Gift Vote as the Host runs it. */
function EndOfGame({ game, posts }: { game: GameView; posts: Post[] }) {
  const { vote } = game;
  const holderOf = (giftId: string | null) => {
    const holderId = game.gifts.find((g) => g.id === giftId)?.holderId;
    return game.players.find((p) => p.id === holderId)?.name ?? "nobody";
  };

  if (vote.status === "none") {
    return (
      <section className="card now">
        <h2 className="big">Game over</h2>
        <p className="muted">Here's who went home with what.</p>
        <p className="thanks">{THANKS}</p>
      </section>
    );
  }

  if (vote.status === "closed") {
    const counts = vote.counts ?? {};
    const winner = game.gifts.find((g) => g.id === vote.winner);
    // Posts come newest first: the latest Photo of the winner, if anyone posted one.
    const photo = winner && posts.find((p) => p.giftId === winner.id && p.status === "visible" && p.photo);
    // Most votes first; the winner leads any Gifts it tied with, since the Host picked it. Five places, as in v1.
    const podium = game.gifts
      .filter((g) => (counts[g.id] ?? 0) > 0)
      .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0) || Number(b.id === vote.winner) - Number(a.id === vote.winner))
      .slice(0, 5);
    return (
      <section className="card now reveal" aria-label="Results">
        {winner ? (
          <div className="reveal-winner">
            {photo && <PostPhoto post={photo} className="reveal-photo" />}
            <div>
              <p className="label">The votes are in</p>
              <p className="big">Worst Gift: {winner.name}</p>
              <p className="medium">{holderOf(winner.id)} picks a prize!</p>
            </div>
          </div>
        ) : (
          <p className="big">Nobody voted</p>
        )}
        {podium.length > 0 && (
          <ol className="podium" aria-label="Results">
            {podium.map((g, rank) => (
              <li key={g.id} data-rank={rank + 1}>
                <strong>{g.name}</strong> <span className="muted">· {holderOf(g.id)} · {votesText(counts[g.id] ?? 0)}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="thanks">{THANKS}</p>
      </section>
    );
  }

  return (
    <>
      <section className="card now" aria-live="polite">
        <p className="big">Vote for the worst Gift!</p>
        <p className="medium">{votesText(vote.cast)} cast</p>
        <p className="muted">Scan the code below, sign in, and vote on your phone.</p>
      </section>
      {vote.display === "live" && vote.counts && <Tally game={game} counts={vote.counts} holderOf={holderOf} />}
      {vote.display === "parade" && <Parade game={game} posts={posts} holderOf={holderOf} />}
    </>
  );
}

/** The counts so far, as bars against the leader. */
function Tally({ game, counts, holderOf }: { game: GameView; counts: Record<string, number>; holderOf: (id: string) => string }) {
  const most = Math.max(1, ...Object.values(counts));
  return (
    <section className="card">
      <ol className="tally" aria-label="Votes so far">
        {game.gifts.map((g) => (
          <li key={g.id} aria-label={g.name}>
            <span className="tally-bar" style={{ width: `${((counts[g.id] ?? 0) / most) * 100}%` }} />
            <span className="tally-text">
              <strong>{g.name}</strong> <span className="muted">· {holderOf(g.id)}</span>
            </span>
            <span className="tally-count">{votesText(counts[g.id] ?? 0)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Every Gift scrolling slowly past (with a Photo of it, if someone posted one), to remind the room what's out there. */
function Parade({ game, posts, holderOf }: { game: GameView; posts: Post[]; holderOf: (id: string) => string }) {
  const photoOf = (giftId: string) => posts.find((p) => p.giftId === giftId && p.status === "visible" && p.photo);
  const items = (copy: boolean) =>
    game.gifts.map((g) => {
      const photo = photoOf(g.id);
      return (
        <li key={`${copy}-${g.id}`} className="parade-item">
          {photo && <PostPhoto post={photo} className="parade-photo" />}
          <span>
            <strong>{g.name}</strong> <span className="muted">· {holderOf(g.id)}</span>
          </span>
        </li>
      );
    });
  return (
    <section className="card parade-window">
      {/* Two copies one after the other, so the loop never shows a gap; only the first is read out. */}
      <div className="parade-track" style={{ animationDuration: `${Math.max(12, game.gifts.length * 4)}s` }}>
        <ul className="parade" aria-label="Gift parade">
          {items(false)}
        </ul>
        <ul className="parade" aria-hidden="true">
          {items(true)}
        </ul>
      </div>
    </section>
  );
}

/** How many Posts the room sees at once: few enough to read from across it. */
const ON_SCREEN = 6;

/**
 * The newest visible Posts. The screen is often opened in the Host's own browser, which is sent Pending and
 * Hidden Posts too; the whole room sees this screen, so it shows only what everyone may see.
 */
function LatestPosts({ game, posts }: { game: GameView; posts: Post[] }) {
  const latest = posts.filter((p) => p.status === "visible").slice(0, ON_SCREEN);
  const giftName = (giftId: string | null) => game.gifts.find((g) => g.id === giftId)?.name;
  return (
    <section className="card" aria-label="Posts">
      <p className="label">Latest Posts</p>
      <div role="feed" aria-label="Latest Posts" className="screen-posts">
        {latest.length === 0 && <p className="muted">Post from your phone and it shows up here.</p>}
        {latest.map((p) => (
          <article key={p.id} className="screen-post">
            <PostPhoto post={p} className="screen-photo" />
            <p>
              <strong>{p.author}</strong>
              {giftName(p.giftId) && <span className="muted"> · about {giftName(p.giftId)}</span>}
            </p>
            {p.replyTo && <QuoteCard quote={p.replyTo} />}
            {p.text && <p className="post-text">{p.text}</p>}
            <Reactions gameId={game.id} post={p} readOnly />
          </article>
        ))}
      </div>
    </section>
  );
}

/** The QR code for following along; `big` fills the screen, for when the Host puts it up on its own. */
function Join({ gameId, big = false }: { gameId: string; big?: boolean }) {
  const url = `${window.location.origin}/games/${gameId}`;
  const qr = useMemo(() => `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(url, { border: 2 }))}`, [url]);
  return (
    <section className={big ? "card join join-big" : "card join"} aria-label="Join">
      <img src={qr} alt="QR code to join this Game" width={220} height={220} />
      <div>
        <p className="label">Follow along on your phone</p>
        <p className="url">{url}</p>
      </div>
    </section>
  );
}
