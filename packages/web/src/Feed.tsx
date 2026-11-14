import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "react-router";
import type { GameView, Moderation, Post } from "./api.js";
import { useApi } from "./ApiContext.js";
import { SignInForm, useSignedIn } from "./SignIn.js";

/**
 * The Feed as this viewer may see it, reloaded whenever the server says it changed (`changes` rises).
 * Also returns a function to reload it now, after this screen changed it.
 */
export function useFeed(gameId: string, changes: number): [Post[], () => void] {
  const api = useApi();
  const [posts, setPosts] = useState<Post[]>([]);
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    let current = true;
    api.posts(gameId).then(
      (loaded) => current && setPosts(loaded),
      () => {}, // keep showing what we had; the next change tries again
    );
    return () => {
      current = false;
    };
  }, [api, gameId, changes, asked]);

  return [posts, () => setAsked((n) => n + 1)];
}

const modes: { mode: Moderation; label: string }[] = [
  { mode: "open", label: "Open: Posts appear at once" },
  { mode: "approval", label: "Approval: each Post waits for you to approve it" },
  { mode: "paused", label: "Paused: nobody can post" },
];

/** The Game's Posts, newest first, with a way to post and, for the Hosts, to moderate. */
export function Feed({
  game,
  posts,
  reload,
  offerSignIn,
}: {
  game: GameView;
  posts: Post[];
  reload: () => void;
  /** False when the page already offers sign-in elsewhere (the join panel), so it isn't asked for twice. */
  offerSignIn: boolean;
}) {
  const api = useApi();
  const hosting = game.role !== null;
  const giftName = (id: string | null) => game.gifts.find((g) => g.id === id)?.name;

  async function setStatus(post: Post, status: "visible" | "hidden") {
    if (await api.setPostStatus(game.id, post.id, status)) reload();
  }

  return (
    <section className="card" aria-label="Posts">
      <h2>Feed</h2>
      {hosting && (
        <fieldset className="choices">
          <legend>Posting</legend>
          {modes.map(({ mode, label }) => (
            <label key={mode}>
              <input
                type="radio"
                name="moderation"
                checked={game.moderation === mode}
                onChange={() => void api.setModeration(game.id, mode)}
              />
              {label}
            </label>
          ))}
        </fieldset>
      )}
      {game.phase !== "ended" && <Composer game={game} onPosted={reload} offerSignIn={offerSignIn} />}
      <div role="feed" aria-label="Feed" className="feed">
        {posts.length === 0 && <p className="muted">No Posts yet.</p>}
        {posts.map((p) => (
          <article key={p.id} className={`post ${p.status}`}>
            <p className="post-meta">
              <strong>{p.author}</strong>
              {p.giftId && giftName(p.giftId) && <span className="muted"> · about {giftName(p.giftId)}</span>}
            </p>
            {p.status === "pending" && <p className="badge">Waiting for the Host to approve</p>}
            {p.status === "hidden" && <p className="badge">Hidden</p>}
            <p className="post-text">{p.text}</p>
            {hosting && (
              <div className="inline">
                {p.status === "pending" && <button onClick={() => void setStatus(p, "visible")}>Approve</button>}
                {p.status === "hidden" ? (
                  <button className="link" onClick={() => void setStatus(p, "visible")}>
                    Show again
                  </button>
                ) : (
                  <button className="link danger" onClick={() => void setStatus(p, "hidden")}>
                    Hide
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function Composer({ game, onPosted, offerSignIn }: { game: GameView; onPosted: () => void; offerSignIn: boolean }) {
  const api = useApi();
  const { pathname } = useLocation();
  const signedIn = useSignedIn();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [giftId, setGiftId] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (game.moderation === "paused") return <p className="muted">The Host has paused posting for now.</p>;
  if (signedIn === "loading") return null;
  if (!signedIn) return offerSignIn ? <SignInForm next={pathname} heading="Sign in to post" /> : <p className="muted">Sign in above to post.</p>;

  // A Player posts as their Player; anyone else says what name to show.
  const asks = !game.me;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const result = await api.post(game.id, {
      text: text.trim(),
      ...(asks ? { name: name.trim() } : {}),
      ...(giftId ? { giftId } : {}),
    });
    if (result === "posted") {
      setText("");
      setGiftId("");
      setError(null);
      onPosted();
    } else {
      setError(result === "paused" ? "The Host has paused posting." : "That didn't post. Please try again.");
    }
  }

  return (
    <form className="stack" aria-label="Post to the Feed" onSubmit={submit}>
      {asks && (
        <>
          <label htmlFor="post-name">Your name</label>
          <input id="post-name" autoComplete="given-name" maxLength={100} required value={name} onChange={(e) => setName(e.target.value)} />
        </>
      )}
      <label htmlFor="post-text">What's happening?</label>
      <textarea id="post-text" rows={2} maxLength={500} required value={text} onChange={(e) => setText(e.target.value)} />
      {game.gifts.length > 0 && (
        <>
          <label htmlFor="post-gift">About a Gift? (optional)</label>
          <select id="post-gift" value={giftId} onChange={(e) => setGiftId(e.target.value)}>
            <option value="">No, just the Feed</option>
            {game.gifts.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </>
      )}
      {game.moderation === "approval" && <p className="muted hint">The Host approves each Post before others see it.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={!text.trim() || (asks && !name.trim())}>
        Post
      </button>
    </form>
  );
}
