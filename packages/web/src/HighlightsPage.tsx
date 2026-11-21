import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { GameView } from "./api.js";
import { useApi } from "./ApiContext.js";
import { useFeed } from "./Feed.js";
import { Highlights, highlightsOf, type Highlight } from "./Highlights.js";
import { ThemeLogo, useTheme } from "./theme.js";
import { useLiveGame } from "./useLiveGame.js";

/** Where a Game's highlights page is. */
export const highlightsPath = (gameId: string) => `/games/${gameId}/highlights`;

/** On a finished Game's pages: the way to the highlights, for everyone. */
export function HighlightsLink({ game }: { game: GameView }) {
  return (
    <section className="card highlights-link">
      <h2>
        <Link to={highlightsPath(game.id)}>✨ The night's highlights</Link>
      </h2>
      <p className="muted">The Photos, the funniest Posts and the pitches, to look back on and share.</p>
    </section>
  );
}

/**
 * The night's highlights, for anyone with the Game's link, once it's over: the same things the big screen's
 * slideshow shows, laid out to scroll through on a phone, with the slideshow a tap away and a link to share.
 */
export function HighlightsPage() {
  const { id = "" } = useParams();
  const [game, , feedChanges] = useLiveGame(id);
  const [posts] = useFeed(id, feedChanges);
  const [playing, setPlaying] = useState(false);
  useTheme(game && game !== "loading" ? game.theme : undefined);

  useEffect(() => {
    if (!playing) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setPlaying(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [playing]);

  if (game === "loading") return <p className="muted">Loading…</p>;
  if (!game) return <p className="error">There's no Game at this link. Check it with your Host.</p>;

  const back = (
    <Link to={`/games/${game.id}`} className="back">
      ← Back to the Game
    </Link>
  );

  if (game.phase !== "ended") {
    return (
      <div className="stack">
        {back}
        <section className="card">
          <h2>The night's highlights</h2>
          <p>They'll be here once the Game is over: the Photos, the funniest Posts and the pitches.</p>
        </section>
      </div>
    );
  }

  const all = highlightsOf(game, posts);
  const of = <K extends Highlight["kind"]>(kind: K) => all.filter((h): h is Extract<Highlight, { kind: K }> => h.kind === kind);
  const [facts, photos, quotes, taglines] = [of("fact"), of("photo"), of("quote"), of("tagline")];

  return (
    <div className="stack highlights-page">
      {back}
      <header className="card highlights-page-head">
        <ThemeLogo theme={game.theme} />
        <h2>{game.name}</h2>
        <p className="muted">The night's highlights</p>
        {all.length > 0 && (
          <div className="actions">
            <button type="button" onClick={() => setPlaying(true)}>
              ▶ Play the slideshow
            </button>
            <ShareHighlights game={game} />
          </div>
        )}
      </header>

      {facts.length > 0 && (
        <section className="card" aria-label="The night in numbers">
          <ul className="hp-facts">
            {facts.map((f) => (
              <li key={f.key}>
                <strong>{f.title}</strong>
                <span className="muted">{f.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {photos.length > 0 && (
        <section className="card" aria-label="Photos">
          <h3>📸 Photos</h3>
          <div className="hp-photos">
            {photos.map((p) => (
              <figure key={p.key}>
                <img src={p.url} alt={p.caption ?? `A Photo from ${p.by}${p.gift ? ` of ${p.gift}` : ""}`} loading="lazy" />
                <figcaption>
                  {p.caption && <span>{p.caption} </span>}
                  <span className="muted">
                    {p.by}
                    {p.gift && ` · ${p.gift}`}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="muted hint">Photos are kept for 60 days after the party.</p>
        </section>
      )}

      {quotes.length > 0 && (
        <section className="card" aria-label="The funniest Posts">
          <h3>😂 The funniest Posts</h3>
          <ul className="hp-quotes">
            {quotes.map((q) => (
              <li key={q.key}>
                <blockquote>“{q.text}”</blockquote>
                <span className="muted">
                  {q.by}
                  {q.gift && ` · about ${q.gift}`} {q.reactions}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {taglines.length > 0 && (
        <section className="card" aria-label="The pitches">
          <h3>🎤 The pitches</h3>
          <ul className="hp-quotes">
            {taglines.map((t) => (
              <li key={t.key}>
                <strong className="hp-tagline">{t.tagline}</strong>
                <span className="muted">
                  {t.by}'s pitch for {t.gift}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {all.length === 0 && (
        <section className="card">
          <p className="muted">Nobody posted this time, so there's nothing to look back on here.</p>
        </section>
      )}

      {playing && (
        <div className="highlights-overlay" role="dialog" aria-modal="true" aria-label="Slideshow">
          <button type="button" className="secondary" onClick={() => setPlaying(false)} autoFocus>
            ✕ Close the slideshow
          </button>
          <Highlights game={game} posts={posts} />
        </div>
      )}
    </div>
  );
}

/** Sends this page's link: the phone's own share sheet where there is one, otherwise copied to paste. */
function ShareHighlights({ game }: { game: GameView }) {
  const api = useApi();
  const [note, setNote] = useState<string | null>(null);
  const url = `${window.location.origin}${highlightsPath(game.id)}`;
  const text = `The highlights from ${game.name}, our White Elephant gift swap on Elephant Exchange:`;

  async function share() {
    setNote(null);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text, url });
        api.noteFeature(game.id, "share");
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return; // they changed their mind
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setNote("Link copied, ready to paste.");
      api.noteFeature(game.id, "share");
    } catch {
      setNote("This browser can't share or copy. Copy the address from the address bar?");
    }
  }

  return (
    <>
      <button type="button" className="secondary" onClick={() => void share()}>
        Share the highlights
      </button>
      {note && (
        <span className="muted hint" role="status">
          {note}
        </span>
      )}
    </>
  );
}
