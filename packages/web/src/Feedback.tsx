import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { FeedbackAsk, FeedbackSummary, GameView } from "./api.js";
import { useApi } from "./ApiContext.js";

const STARS = [1, 2, 3, 4, 5] as const;
const AGAIN = [
  ["yes", "Yes"],
  ["maybe", "Maybe"],
  ["no", "No"],
] as const;

/**
 * Asks how the Game went, once it's over (docs/stats-plan.md, Phase 3): the Host and Co-hosts give 1–5 stars, a
 * guest a thumbs up or down, each with an optional comment. The server says whether to ask; nothing shows mid-game,
 * while the vote is under way, in a demo, or to someone signed out.
 */
export function FeedbackCard({ game }: { game: GameView }) {
  const api = useApi();
  const [ask, setAsk] = useState<FeedbackAsk | null>(null);
  const [thanked, setThanked] = useState(false);

  useEffect(() => {
    let current = true;
    api.feedbackFor(game.id).then((a) => current && setAsk(a));
    return () => {
      current = false;
    };
  }, [api, game.id, game.phase, game.vote.status]);

  if (!ask?.asked) return null;
  if (ask.given && !thanked) {
    return (
      <section className="card feedback" aria-label="How did it go?">
        <p className="muted">Thanks for telling us how it went.</p>
      </section>
    );
  }
  return ask.as === "host" ? <HostAsk gameId={game.id} onDone={() => setThanked(true)} /> : <GuestAsk gameId={game.id} />;
}

function HostAsk({ gameId, onDone }: { gameId: string; onDone: () => void }) {
  const api = useApi();
  const [rating, setRating] = useState(0);
  const [again, setAgain] = useState<"yes" | "maybe" | "no" | null>(null);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"asking" | "sending" | "sent" | "failed">("asking");

  async function send(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    const ok = await api.giveFeedback(gameId, { rating, ...(again ? { again } : {}), ...(comment.trim() ? { comment: comment.trim() } : {}) });
    setState(ok ? "sent" : "failed");
    if (ok) onDone();
  }

  if (state === "sent") {
    return (
      <section className="card feedback" aria-label="How did it go?">
        <p role="status">Thanks! Jim reads every answer, and they decide what gets better next.</p>
      </section>
    );
  }
  return (
    <form className="card feedback stack" aria-label="How did it go?" onSubmit={send}>
      <h2>How did it go?</h2>
      <div role="radiogroup" aria-label="Stars" className="stars">
        {STARS.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
            className={n <= rating ? "star on" : "star"}
            onClick={() => setRating(n)}
          >
            ★
          </button>
        ))}
      </div>
      <fieldset className="inline-choices">
        <legend>Would you use it again?</legend>
        {AGAIN.map(([value, label]) => (
          <label key={value} className="check">
            <input type="radio" name="again" checked={again === value} onChange={() => setAgain(value)} />
            {label}
          </label>
        ))}
      </fieldset>
      <label htmlFor="feedback-comment">Anything to add? (optional)</label>
      <textarea id="feedback-comment" rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
      <button type="submit" disabled={rating === 0 || state === "sending"}>
        Send
      </button>
      {state === "failed" && (
        <p className="error" role="alert">
          That didn't send. Please try again.
        </p>
      )}
    </form>
  );
}

function GuestAsk({ gameId }: { gameId: string }) {
  const api = useApi();
  const [thumbs, setThumbs] = useState<"up" | "down" | null>(null);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);

  async function choose(choice: "up" | "down") {
    if (await api.giveFeedback(gameId, { thumbs: choice })) setThumbs(choice);
  }
  async function add(e: FormEvent) {
    e.preventDefault();
    if (thumbs && (await api.giveFeedback(gameId, { thumbs, comment: comment.trim() }))) setDone(true);
  }

  if (done) {
    return (
      <section className="card feedback" aria-label="Did you enjoy it?">
        <p role="status">Thanks!</p>
      </section>
    );
  }
  if (!thumbs) {
    return (
      <section className="card feedback stack" aria-label="Did you enjoy it?">
        <h2>Did you enjoy it?</h2>
        <div className="inline">
          <button type="button" className="secondary" onClick={() => void choose("up")}>
            👍 Yes
          </button>
          <button type="button" className="secondary" onClick={() => void choose("down")}>
            👎 Not really
          </button>
        </div>
      </section>
    );
  }
  return (
    <form className="card feedback stack" aria-label="Did you enjoy it?" onSubmit={add}>
      <p role="status">Thanks! Anything to add? (optional)</p>
      <textarea aria-label="Anything to add?" rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
      <div className="inline">
        <button type="submit" disabled={!comment.trim()}>
          Send
        </button>
        <button type="button" className="secondary" onClick={() => setDone(true)}>
          No thanks
        </button>
      </div>
    </form>
  );
}

/** An idea for Jim, from the Host's home screen. */
export function SuggestBox() {
  const api = useApi();
  const [text, setText] = useState("");
  const [state, setState] = useState<"writing" | "sent" | "failed">("writing");

  async function send(e: FormEvent) {
    e.preventDefault();
    const ok = await api.suggest(text.trim());
    setState(ok ? "sent" : "failed");
    if (ok) setText("");
  }

  return (
    <form className="card stack" aria-label="Suggest something" onSubmit={send}>
      <h3>Suggest something</h3>
      <label htmlFor="suggestion" className="muted hint">
        An idea, something that confused you, or something you'd like it to do.
      </label>
      <textarea id="suggestion" rows={3} maxLength={2000} value={text} onChange={(e) => (setText(e.target.value), setState("writing"))} />
      <button type="submit" className="secondary" disabled={!text.trim()}>
        Send to Jim
      </button>
      {state === "sent" && <p role="status">Thanks! Jim reads every one.</p>}
      {state === "failed" && (
        <p className="error" role="alert">
          That didn't send. Please try again.
        </p>
      )}
    </form>
  );
}

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const KIND = { host: "Host", guest: "Guest", suggestion: "Suggestion" } as const;

/** What Hosts and guests said, for the admin: the averages, then every answer, newest first. */
export function FeedbackPage() {
  const api = useApi();
  const [said, setSaid] = useState<FeedbackSummary | "loading" | "notFound" | "failed">("loading");

  useEffect(() => {
    api.adminFeedback().then(setSaid, () => setSaid("failed"));
  }, [api]);

  if (said === "loading") return <p className="muted">Loading…</p>;
  if (said === "notFound") return <p>There's nothing here.</p>;
  if (said === "failed") return <p className="error">The feedback couldn't be loaded. Please reload the page.</p>;

  const figures: [string, string | number][] = [
    ["Host rating", said.averageRating === null ? "—" : `${said.averageRating} ★`],
    ["Ratings", said.ratings],
    ["Would use again", `${said.again.yes} yes · ${said.again.maybe} maybe · ${said.again.no} no`],
    ["Guests", `${said.thumbs.up} 👍 · ${said.thumbs.down} 👎`],
    ["Suggestions", said.suggestions],
  ];

  return (
    <div className="stack admin">
      <Link to="/admin" className="back">
        ← Admin
      </Link>
      <section className="card" aria-label="Feedback totals">
        <h2>Feedback</h2>
        <dl className="stat-tiles">
          {figures.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className="smaller">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="card">
        <h2>What people said</h2>
        {said.items.length === 0 ? (
          <p className="muted">Nothing yet. Hosts are asked after End Game, guests after the vote.</p>
        ) : (
          <ul className="feedback-list" aria-label="What people said">
            {said.items.map((f, i) => (
              <li key={`${f.at}-${i}`}>
                <p className="feedback-meta">
                  <strong>{KIND[f.kind]}</strong>
                  {f.game && <> · {f.game}</>} · {f.from ?? <span className="muted">no longer signed up</span>} ·{" "}
                  <span className="muted">{when(f.at)}</span>
                </p>
                <p>
                  {f.rating !== null && <span aria-label={`${f.rating} stars`}>{"★".repeat(f.rating)}{"☆".repeat(5 - f.rating)} </span>}
                  {f.again && <span className="muted">again: {f.again} </span>}
                  {f.thumbs && <span>{f.thumbs === "up" ? "👍" : "👎"} </span>}
                </p>
                {f.comment && <blockquote>{f.comment}</blockquote>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
