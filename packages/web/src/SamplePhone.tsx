import { useMemo } from "react";
import { Link } from "react-router";
import type { Api, GameView, Post } from "./api.js";
import { ApiProvider, useApi } from "./ApiContext.js";
import { GamePage } from "./GamePage.js";
import sampleGame from "./sample/game.json";
import samplePosts from "./sample/posts.json";

/**
 * The Game in the front page's scoreboard picture. Its QR code and link point here, so someone who scans the
 * picture sees what a guest's phone shows instead of "there's no Game at this link".
 */
export const SAMPLE_GAME_ID = sampleGame.id;

/**
 * What a guest sees on their phone, from the party in the front page's picture: the real phone screens, fed a
 * fixed copy of that party instead of a live one. Nothing is sent anywhere; the turn timer starts afresh on arrival.
 */
export function SamplePhone() {
  const real = useApi();
  const api = useMemo<Api>(() => {
    const at = Date.now();
    const game = {
      ...sampleGame,
      clock: { ...sampleGame.clock, now: at, startedAt: Object.fromEntries(Object.keys(sampleGame.clock.startedAt).map((p) => [p, at - 4000])) },
    } as unknown as GameView;
    return {
      ...real,
      now: () => Date.now(),
      session: async () => undefined,
      game: async () => game,
      watch: () => () => {},
      posts: async () => samplePosts as unknown as Post[],
      feedbackFor: async () => null,
    };
  }, [real]);

  return (
    <div className="stack sample-phone">
      <section className="card sample-note" aria-label="A sample">
        <p>
          <strong>This is a sample.</strong> It's what guests see on their phones during a party, from the one on the TV in
          our picture. Tap the tabs at the bottom to look around.
        </p>
        <div className="inline">
          <Link to="/try" className="button">
            ▶ Try the demo
          </Link>
          <Link to="/about" className="button secondary-button">
            About
          </Link>
        </div>
      </section>
      <ApiProvider api={api}>
        <GamePage gameId={SAMPLE_GAME_ID} />
      </ApiProvider>
    </div>
  );
}
