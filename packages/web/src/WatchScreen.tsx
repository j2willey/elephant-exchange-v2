import { useMemo } from "react";
import { useParams } from "react-router";
import { renderSVG } from "uqr";
import { Gifts } from "./GamePage.js";
import { useLiveGame } from "./useLiveGame.js";

/** For a projector or TV at the party: who's up, the Gifts, and how to join. It only watches. */
export function WatchScreen() {
  const { id = "" } = useParams();
  const [game] = useLiveGame(id);

  if (game === "loading") return <p className="muted">Loading…</p>;
  if (!game) return <p className="error">There's no Game at this link. Check it with your Host.</p>;

  const nameOf = (playerId: string) => game.players.find((p) => p.id === playerId)?.name ?? "?";
  const players = game.players.length;

  return (
    <div className="screen">
      {game.phase === "setup" ? (
        <section className="card now">
          <p className="big">Waiting for the Host to start</p>
          <p className="muted">
            {players} {players === 1 ? "player" : "players"} so far
          </p>
        </section>
      ) : (
        <div className="screen-top">
          <section className="card now" aria-live="polite">
            <p className="label">Up now</p>
            <p className="big">{game.active.map(nameOf).join(", ") || "—"}</p>
          </section>
          <section className="card">
            <p className="label">On deck</p>
            <p className="medium">{game.onDeck.map(nameOf).join(", ") || "—"}</p>
          </section>
        </div>
      )}
      {game.gifts.length > 0 && <Gifts game={game} />}
      <Join gameId={game.id} />
    </div>
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
