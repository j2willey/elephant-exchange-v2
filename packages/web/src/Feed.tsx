import { useEffect, useId, useState, type FormEvent } from "react";
import { useLocation } from "react-router";
import { REACTIONS, type Emoji, type GameView, type Post, type Quote } from "./api.js";
import { useApi } from "./ApiContext.js";
import { shrinkPhoto } from "./shrinkPhoto.js";
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

/** The Game's Posts, newest first, with a way to post and, for the Hosts, to approve or hide each one (posting itself is set on the settings page). */
export function Feed({
  game,
  posts,
  reload,
  offerSignIn,
  composer = true,
}: {
  game: GameView;
  posts: Post[];
  reload: () => void;
  /** False where posting has a panel of its own (a guest's phone). */
  composer?: boolean;
  /** False when the page already offers sign-in elsewhere (the join panel), so it isn't asked for twice. */
  offerSignIn: boolean;
}) {
  const api = useApi();
  const hosting = game.role !== null;
  const signedIn = useSignedIn() === true;
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const giftName = (id: string | null) => game.gifts.find((g) => g.id === id)?.name;
  // Replying is posting, so it goes when posting does: once the Game ends, or while the Host has it Paused.
  const canReply = signedIn && game.phase !== "ended" && game.moderation !== "paused";

  /** Brings the Post a reply answers into view, and moves focus to it so it's clear which one it is. */
  function showOriginal(postId: string) {
    const original = document.getElementById(`feed-post-${postId}`);
    original?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    original?.focus({ preventScroll: true });
  }

  async function setStatus(post: Post, status: "visible" | "hidden") {
    if (await api.setPostStatus(game.id, post.id, status)) reload();
  }

  return (
    <section className="card" aria-label="Posts">
      <h2>Feed</h2>
      {composer && game.phase !== "ended" && <Composer game={game} onPosted={reload} offerSignIn={offerSignIn} />}
      <div role="feed" aria-label="Feed" className="feed">
        {posts.length === 0 && <p className="muted">No Posts yet.</p>}
        {posts.map((p) => (
          <article key={p.id} id={`feed-post-${p.id}`} tabIndex={-1} aria-label={`Post from ${p.author}`} className={`post ${p.status}`}>
            <p className="post-meta">
              <strong>{p.author}</strong>
              {p.giftId && giftName(p.giftId) && <span className="muted"> · about {giftName(p.giftId)}</span>}
              {p.replies > 0 && <span className="muted"> · {p.replies === 1 ? "1 reply" : `${p.replies} replies`}</span>}
            </p>
            {p.replyTo && <QuoteCard quote={p.replyTo} onOpen={showOriginal} />}
            {p.status === "pending" && <p className="badge">Waiting for the Host to approve</p>}
            {p.status === "hidden" && <p className="badge">Hidden</p>}
            {p.text && <p className="post-text">{p.text}</p>}
            {p.photo && <PostPhoto post={p} />}
            {p.status === "visible" && (
              <div className="post-actions">
                <Reactions gameId={game.id} post={p} reload={reload} />
                {canReply && (
                  <button type="button" className="reaction add" aria-expanded={replyingTo === p.id} onClick={() => setReplyingTo(replyingTo === p.id ? null : p.id)}>
                    Reply
                  </button>
                )}
              </div>
            )}
            {canReply && replyingTo === p.id && (
              <Composer
                game={game}
                replyTo={p}
                offerSignIn={false}
                onPosted={() => {
                  setReplyingTo(null);
                  reload();
                }}
              />
            )}
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

/**
 * The Post a reply answers, shrunk: who wrote it, its first words and a thumbnail of its Photo. Tapping it goes to
 * the original. Shown as removed once the viewer can no longer see it.
 */
export function QuoteCard({ quote, onOpen }: { quote: Quote; onOpen?: (postId: string) => void }) {
  if ("removed" in quote) return <p className="quote removed">↩ Original post removed</p>;
  const words = quote.text || "a Photo";
  const inside = (
    <>
      {quote.photo && <img className="quote-photo" src={quote.photo.url} alt="" width={40} height={40} loading="lazy" />}
      <span className="quote-text">
        <strong>{quote.author}</strong>: {words}
      </span>
    </>
  );
  return onOpen ? (
    <button type="button" className="quote" aria-label={`Replying to ${quote.author}: ${words}`} onClick={() => onOpen(quote.id)}>
      {inside}
    </button>
  ) : (
    <p className="quote" aria-label={`Replying to ${quote.author}: ${words}`}>
      {inside}
    </p>
  );
}

const nameOf = (emoji: Emoji) => REACTIONS.find((r) => r.emoji === emoji)!.name;

/**
 * A Post's Reactions: a chip for each one it has, with its count. Someone signed in taps a chip to add theirs or
 * take it back, and React to pick from all six; someone signed out, or the big screen (`readOnly`), sees just the counts.
 */
export function Reactions({ gameId, post, reload, readOnly = false }: { gameId: string; post: Post; reload?: () => void; readOnly?: boolean }) {
  const api = useApi();
  const signedIn = useSignedIn() === true && !readOnly;
  const [picking, setPicking] = useState(false);

  async function toggle(emoji: Emoji, on: boolean) {
    setPicking(false);
    if (await api.react(gameId, post.id, emoji, on)) reload?.();
  }

  if (!signedIn && post.reactions.length === 0) return null;
  return (
    <div className="reactions">
      {post.reactions.map((r) =>
        signedIn ? (
          <button
            key={r.emoji}
            type="button"
            className={r.mine ? "reaction mine" : "reaction"}
            aria-pressed={r.mine}
            aria-label={`${nameOf(r.emoji)}: ${r.count}`}
            onClick={() => void toggle(r.emoji, !r.mine)}
          >
            {r.emoji} {r.count}
          </button>
        ) : (
          <span key={r.emoji} className="reaction" aria-label={`${nameOf(r.emoji)}: ${r.count}`}>
            {r.emoji} {r.count}
          </span>
        ),
      )}
      {signedIn && (
        <button type="button" className="reaction add" aria-expanded={picking} onClick={() => setPicking(!picking)}>
          React
        </button>
      )}
      {picking && (
        <div className="reaction-picker" role="group" aria-label="Reactions">
          {REACTIONS.map(({ emoji, name }) => {
            const mine = post.reactions.some((r) => r.emoji === emoji && r.mine);
            return (
              <button key={emoji} type="button" aria-label={name} aria-pressed={mine} onClick={() => void toggle(emoji, !mine)}>
                {emoji}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A Post's Photo, sized from the start so the Feed doesn't jump as it loads. */
export function PostPhoto({ post, className = "post-photo" }: { post: Post; className?: string }) {
  if (!post.photo) return null;
  return (
    <img
      className={className}
      src={post.photo.url}
      alt={`Photo from ${post.author}`}
      width={post.photo.width}
      height={post.photo.height}
      loading="lazy"
    />
  );
}

const postErrors = {
  paused: "The Host has paused posting.",
  notPhoto: "That doesn't look like a photo we can use. Try another?",
  tooBig: "That Photo is too big to send. Try another?",
  unshrinkable: "This photo couldn't be made smaller on this phone. Try taking a screenshot of it and posting that.",
  failed: "That didn't post. Please try again.",
};

/** The form for a new Post or, given `replyTo`, a reply to that one (which isn't about a Gift of its own). */
export function Composer({ game, onPosted, offerSignIn, replyTo }: { game: GameView; onPosted: () => void; offerSignIn: boolean; replyTo?: Post }) {
  const api = useApi();
  const { pathname } = useLocation();
  const signedIn = useSignedIn();
  const [name, setName] = useState(() => api.guestName());
  const [text, setText] = useState("");
  const [giftId, setGiftId] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = usePreview(photo);
  // Its own ids, since a reply's form can be open beside the main one.
  const ids = useId();

  if (game.moderation === "paused") return <p className="muted">The Host has paused posting for now.</p>;
  if (signedIn === "loading") return null;
  if (!signedIn) return offerSignIn ? <SignInForm next={pathname} heading="Sign in to post" /> : <p className="muted">Sign in above to post.</p>;

  // A Player posts as their Player; anyone else says what name to show.
  const asks = !game.me;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    // Shrunk on the phone, never sent full size (see shrinkPhoto).
    const shrunk = photo ? await shrinkPhoto(photo).catch(() => null) : undefined;
    if (shrunk === null) {
      setSending(false);
      setError(postErrors.unshrinkable);
      return;
    }
    const result = await api
      .post(game.id, {
        text: text.trim(),
        ...(asks ? { name: name.trim() } : {}),
        ...(giftId ? { giftId } : {}),
        ...(replyTo ? { replyTo: replyTo.id } : {}),
        ...(shrunk ? { photo: shrunk } : {}),
      })
      .catch(() => "failed" as const);
    setSending(false);
    if (result === "posted") {
      if (asks) api.setGuestName(name.trim());
      setText("");
      setGiftId("");
      setPhoto(null);
      setError(null);
      onPosted();
    } else {
      setError(postErrors[result]);
    }
  }

  return (
    <form className={replyTo ? "stack reply-form" : "stack"} aria-label={replyTo ? `Reply to ${replyTo.author}` : "Post to the Feed"} onSubmit={submit}>
      {asks && (
        <>
          <label htmlFor={`${ids}-name`}>Your name</label>
          <input id={`${ids}-name`} autoComplete="given-name" maxLength={100} required value={name} onChange={(e) => setName(e.target.value)} />
        </>
      )}
      <label htmlFor={`${ids}-text`}>{replyTo ? "Your reply" : "What's happening?"}</label>
      <textarea id={`${ids}-text`} rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
      {photo ? (
        <div className="photo-to-post">
          <img src={preview} alt="Photo to post" />
          <button type="button" className="link danger" onClick={() => setPhoto(null)}>
            Remove photo
          </button>
        </div>
      ) : (
        <>
          <label htmlFor={`${ids}-photo`} className="photo-pick">
            Add a Photo
          </label>
          <input
            id={`${ids}-photo`}
            type="file"
            accept="image/*"
            className="visually-hidden"
            onChange={(e) => {
              setPhoto(e.target.files?.[0] ?? null);
              e.target.value = ""; // so choosing the same file again still counts
            }}
          />
        </>
      )}
      {game.gifts.length > 0 && !replyTo && (
        <>
          <label htmlFor={`${ids}-gift`}>About a Gift? (optional)</label>
          <select id={`${ids}-gift`} value={giftId} onChange={(e) => setGiftId(e.target.value)}>
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
      <button type="submit" disabled={sending || (!text.trim() && !photo) || (asks && !name.trim())}>
        {sending ? "Posting…" : "Post"}
      </button>
    </form>
  );
}

/** A local address for showing a chosen Photo before it's sent, released when it's no longer shown. */
function usePreview(file: File | null): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== "function") return setUrl(undefined);
    const made = URL.createObjectURL(file);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [file]);
  return url;
}
