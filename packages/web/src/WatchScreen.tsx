import { useMemo } from "react";
import { useParams } from "react-router";
import { renderSVG } from "uqr";
import type { GameView, Post } from "./api.js";
import { Countdown } from "./Countdown.js";
import { PostPhoto, useFeed } from "./Feed.js";
import { Gifts } from "./GamePage.js";
import { useLiveGame } from "./useLiveGame.js";

/** For a projector or TV at the party: who's up, the Gifts, and how to join. It only watches. */
export function WatchScreen() {
  const { id = "" } = useParams();
  const [game, , feedChanges] = useLiveGame(id);
  const [posts] = useFeed(id, feedChanges);

  if (game === "loading") return <p className="muted">Loading…</p>;
  if (!game) return <p className="error">There's no Game at this link. Check it with your Host.</p>;

  const nameOf = (playerId: string) => game.players.find((p) => p.id === playerId)?.name ?? "?";
  const players = game.players.length;

  return (
    <div className="screen">
      {game.phase === "ended" ? (
        <section className="card now">
          <h2 className="big">Game over</h2>
          <p className="muted">Here's who went home with what.</p>
        </section>
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
      <LatestPosts game={game} posts={posts} />
      {game.gifts.length > 0 && <Gifts game={game} />}
      <Join gameId={game.id} />
    </div>
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
