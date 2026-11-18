import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useParams } from "react-router";
import { renderSVG } from "uqr";
import type { GameView, Post } from "./api.js";
import { Countdown } from "./Countdown.js";
import { PostPhoto, useFeed } from "./Feed.js";
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
    </div>
  );
}

type Gift = GameView["gifts"][number];

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
                  <strong>{g.name}</strong>
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
      </section>
    );
  }

  if (vote.status === "closed") {
    const counts = vote.counts ?? {};
    const winner = game.gifts.find((g) => g.id === vote.winner);
    // Most votes first; the winner leads any Gifts it tied with, since the Host picked it.
    const podium = game.gifts
      .filter((g) => (counts[g.id] ?? 0) > 0)
      .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0) || Number(b.id === vote.winner) - Number(a.id === vote.winner))
      .slice(0, 3);
    return (
      <section className="card now reveal">
        {winner ? (
          <>
            <p className="label">The votes are in</p>
            <p className="big">Worst Gift: {winner.name}</p>
            <p className="medium">{holderOf(winner.id)} picks a prize!</p>
          </>
        ) : (
          <p className="big">Nobody voted</p>
        )}
        {podium.length > 0 && (
          <ol className="podium" aria-label="Results">
            {podium.map((g) => (
              <li key={g.id}>
                {g.name} <span className="muted">· {votesText(counts[g.id] ?? 0)}</span>
              </li>
            ))}
          </ol>
        )}
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
            {p.text && <p className="post-text">{p.text}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}

function Join({ gameId }: { gameId: string }) {
  const url = `${window.location.origin}/games/${gameId}`;
  const qr = useMemo(() => `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(url, { border: 2 }))}`, [url]);
  return (
    <section className="card join" aria-label="Join">
      <img src={qr} alt="QR code to join this Game" width={220} height={220} />
      <div>
        <p className="label">Follow along on your phone</p>
        <p className="url">{url}</p>
      </div>
    </section>
  );
}
