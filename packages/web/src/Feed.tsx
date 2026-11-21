import { RenameButton } from "./Rename.js";
import { showGift } from "./GiftPosts.js";
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
  onShowGift = showGift,
}: {
  game: GameView;
  posts: Post[];
  reload: () => void;
  /** Where "about Mug" goes: to that Gift on this page, unless the page says otherwise (a phone's Gifts tab). */
  onShowGift?: (giftId: string) => void;
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
  const canReply = signedIn && game.phase !== "ended" && game.moderation !== "paused" && !game.muted;

  /** Brings the Post a reply answers into view, and moves focus to it so it's clear which one it is. */
  function showOriginal(postId: string) {
    const original = document.getElementById(`feed-post-${postId}`);
    original?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    original?.focus({ preventScroll: true });
  }

  async function setStatus(post: Post, status: "visible" | "hidden", thread = false) {
    if (await api.setPostStatus(game.id, post.id, status, thread)) reload();
  }

  return (
    <section className="card" aria-label="Posts">
      <h2>Chat</h2>
      {composer && game.phase !== "ended" && <Composer game={game} onPosted={reload} offerSignIn={offerSignIn} />}
      <div role="feed" aria-label="Chat" className="feed">
        {posts.length === 0 && <p className="muted">No Posts yet.</p>}
        {posts.map((p) => (
          <article key={p.id} id={`feed-post-${p.id}`} tabIndex={-1} aria-label={`Post from ${p.author}`} className={`post ${p.status}`}>
            <p className="post-meta">
              <strong>{p.author}</strong>
              {p.authorMuted && <span className="badge">Muted</span>}
              {p.giftId && giftName(p.giftId) && (
                <span className="muted">
                  {" · "}
                  <button type="button" className="link about-gift" onClick={() => onShowGift(p.giftId!)}>
                    {p.pitchFor ? `🎤 pitching ${giftName(p.giftId)}` : `about ${giftName(p.giftId)}`}
                  </button>
                </span>
              )}
              {p.replies > 0 && <span className="muted"> · {p.replies === 1 ? "1 reply" : `${p.replies} replies`}</span>}
            </p>
            {p.replyTo && <QuoteCard quote={p.replyTo} onOpen={showOriginal} />}
            {p.status === "pending" && <p className="badge">Waiting for the Host to approve</p>}
            {p.status === "hidden" && <p className="badge">Hidden</p>}
            {p.tagline && <p className="pitch-tagline">{p.tagline}</p>}
            {p.text && <p className="post-text">{p.text}</p>}
            {p.photo && <PostPhoto post={p} />}
            {(p.mine || hosting) && !p.pitchFor && game.gifts.length > 0 && <AttachToGift game={game} post={p} onDone={reload} />}
            {p.status === "visible" && (
              <div className="post-actions">
                <Reactions gameId={game.id} post={p} reload={reload} />
                {canReply && (
                  <button type="button" className="reaction add" aria-expanded={replyingTo === p.id} onClick={() => setReplyingTo(replyingTo === p.id ? null : p.id)}>
                    Reply
                  </button>
                )}
                <ShareButton game={game} post={p} />
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
                  <>
                    <button className="link danger" onClick={() => void setStatus(p, "hidden")}>
                      Hide
                    </button>
                    {p.replies > 0 && (
                      <button className="link danger" onClick={() => void setStatus(p, "hidden", true)}>
                        Hide with replies
                      </button>
                    )}
                  </>
                )}
                <MuteButton gameId={game.id} post={p} onDone={reload} />
                <RenameButton gameId={game.id} who={{ postId: p.id }} name={p.author} onDone={reload} />
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
      {quote.photo && <img className="quote-photo" src={quote.photo.smallUrl ?? quote.photo.url} alt="" width={40} height={40} loading="lazy" />}
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

/** How a Reaction looks: its emoji, or the app's own icon for one with no emoji. */
function Glyph({ emoji }: { emoji: Emoji }) {
  return emoji === "leg-lamp" ? <LegLamp /> : <>{emoji}</>;
}

/** The leg's outline: thigh under the shade, calf, ankle. */
const LEG = "M9.3 8.4C9.1 11.4 10.2 13.5 10.1 15.2 10 16.8 10.9 18 11.2 19.4L12.9 19.2C12.9 17 13.9 14.6 14 12.4 14.1 10.8 14.7 9.6 14.7 8.4Z";

/** A lamp shaped like a stockinged leg in a high heel, under a fringed shade: our own drawing, sized like an emoji. */
function LegLamp() {
  const clip = `leg-lamp-${useId().replace(/:/g, "")}`;
  return (
    <svg className="glyph" viewBox="0 0 24 24" width="1.15em" height="1.15em" aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <path d={LEG} />
        </clipPath>
      </defs>
      <path d={LEG} fill="#e9b48c" />
      <g clipPath={`url(#${clip})`} stroke="#6b3f2a" strokeWidth="0.4" opacity="0.55">
        <path d="M6 6l12 12M6 8.5l12 12M6 11l12 12M6 3.5l12 12M6 1l12 12M18 6l-12 12M18 8.5l-12 12M18 11l-12 12M18 3.5l-12 12M18 1l-12 12" />
      </g>
      <path d="M11 19.1L13 18.9C13.7 20 15.4 20.7 17.2 21.3L17.2 22.2 12.7 22.2 12.4 21.3 12.1 22.2 11.3 22.2Z" fill="#1f1f1f" />
      <rect x="8.3" y="22.2" width="9.6" height="1.4" rx="0.5" fill="#3a3a3a" />
      <path d="M8.6 1.3h6.8l3.4 6.9H5.2z" fill="#f4c542" stroke="#a87908" strokeWidth="0.55" strokeLinejoin="round" />
      <path
        d="M5.9 8.3v1.2M7.7 8.3v1.2M9.5 8.3v1.2M11.3 8.3v1.2M13.1 8.3v1.2M14.9 8.3v1.2M16.7 8.3v1.2M18.3 8.3v1.2"
        stroke="#a87908"
        strokeWidth="0.65"
        strokeLinecap="round"
      />
    </svg>
  );
}

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
            <Glyph emoji={r.emoji} /> {r.count}
          </button>
        ) : (
          <span key={r.emoji} className="reaction" aria-label={`${nameOf(r.emoji)}: ${r.count}`}>
            <Glyph emoji={r.emoji} /> {r.count}
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
                <Glyph emoji={emoji} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Shares a Post outside the party: on a phone, through its own share menu (Messages, Slack, Facebook), with the
 * Photo when there is one; elsewhere, by copying the words to paste. The link is to the app's front page, never
 * the Game: a Game's link lets anyone follow its Feed, and a funny moment shared shouldn't open up the whole party.
 */
function ShareButton({ game, post }: { game: GameView; post: Post }) {
  const api = useApi();
  const [note, setNote] = useState<string | null>(null);
  const link = `${window.location.origin}/?ref=share`;
  const said = post.text ? `“${post.text}” (${post.author})` : `A Photo from ${post.author}`;
  const text = `${said}, at ${game.name}. Our White Elephant gift swap runs on Elephant Exchange:`;

  /** The Photo as a file to share, if this phone can share files; it's already loaded, so this is quick. */
  async function photoFile(): Promise<File | undefined> {
    if (!post.photo || typeof navigator.canShare !== "function") return undefined;
    try {
      const res = await fetch(post.photo.url, { cache: "force-cache" });
      if (!res.ok) return undefined;
      const type = res.headers.get("content-type") ?? "image/jpeg";
      const file = new File([await res.arrayBuffer()], `elephant-exchange.${type.split("/")[1] ?? "jpg"}`, { type });
      return navigator.canShare({ files: [file] }) ? file : undefined;
    } catch {
      return undefined;
    }
  }

  async function share() {
    setNote(null);
    if (typeof navigator.share === "function") {
      const file = await photoFile();
      try {
        // With a Photo, some apps drop a separate link, so it goes in the words too.
        await navigator.share(file ? { text: `${text} ${link}`, files: [file] } : { text, url: link });
        api.noteFeature(game.id, "share");
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return; // they changed their mind
        // Otherwise, copy it instead.
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${link}`);
      setNote("Copied, ready to paste.");
      api.noteFeature(game.id, "share");
    } catch {
      setNote("This browser can't share or copy. Try a screenshot?");
    }
  }

  return (
    <>
      <button type="button" className="reaction add" aria-label={`Share ${post.author}'s Post`} onClick={() => void share()}>
        Share
      </button>
      {note && (
        <span className="muted hint" role="status">
          {note}
        </span>
      )}
    </>
  );
}

/**
 * A Post's Photo, sized from the start so the Feed doesn't jump as it loads. Its small copy unless `full`: a hundred
 * phones at a party each load every Photo in the Feed, so lists and thumbnails stay light.
 */
export function PostPhoto({ post, className = "post-photo", full = false }: { post: Post; className?: string; full?: boolean }) {
  if (!post.photo) return null;
  return (
    <img
      className={className}
      src={full ? post.photo.url : (post.photo.smallUrl ?? post.photo.url)}
      alt={`Photo from ${post.author}`}
      width={post.photo.width}
      height={post.photo.height}
      loading="lazy"
    />
  );
}

const postErrors = {
  paused: "The Host has paused posting.",
  muted: "The Host has paused your posting.",
  tooSoon: "That's a lot of posts in a minute. Wait a moment, then try again.",
  notPhoto: "That doesn't look like a photo we can use. Try another?",
  tooBig: "That Photo is too big to send. Try another?",
  unshrinkable: "This photo couldn't be made smaller on this phone. Try taking a screenshot of it and posting that.",
  failed: "That didn't post. Please try again.",
};

/**
 * The form for a new Post; given `replyTo`, a reply to that one (which isn't about a Gift of its own); given `gift`,
 * a Post about that Gift, added right from it (so there's no Gift to pick).
 */
export function Composer({
  game,
  onPosted,
  offerSignIn,
  replyTo,
  gift,
}: {
  game: GameView;
  onPosted: () => void;
  offerSignIn: boolean;
  replyTo?: Post;
  gift?: { id: string; name: string };
}) {
  const api = useApi();
  const { pathname } = useLocation();
  const signedIn = useSignedIn();
  const [name, setName] = useState(() => game.myName?.name ?? api.guestName());
  const [text, setText] = useState("");
  const [giftId, setGiftId] = useState(gift?.id ?? "");
  const [photo, setPhoto] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = usePreview(photo);
  // Its own ids, since a reply's form can be open beside the main one.
  const ids = useId();

  if (game.moderation === "paused") return <p className="muted">The Host has paused posting for now.</p>;
  if (game.muted) return <p className="muted">The Host has paused your posting.</p>;
  if (signedIn === "loading") return null;
  if (!signedIn) return offerSignIn ? <SignInForm next={pathname} heading="Sign in to post" /> : <p className="muted">Sign in above to post.</p>;

  // A Player posts as their Player; anyone else says what name to show, unless the Host has locked theirs.
  const locked = !game.me && game.myName?.locked && game.myName.name ? game.myName.name : undefined;
  const asks = !game.me && !locked;

  /** Changed their mind: back to an empty form. */
  function clear() {
    setText("");
    setGiftId(gift?.id ?? "");
    setPhoto(null);
    setError(null);
  }

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
      clear();
      onPosted();
    } else {
      setError(postErrors[result]);
    }
  }

  return (
    <form
      className={replyTo || gift ? "stack reply-form" : "stack"}
      aria-label={replyTo ? `Reply to ${replyTo.author}` : gift ? `Add a photo of ${gift.name}` : "Post to the Chat"}
      onSubmit={submit}
    >
      {locked && (
        <p className="muted hint">
          Posting as <strong>{locked}</strong>. Your Host set this name.
        </p>
      )}
      {asks && (
        <>
          <label htmlFor={`${ids}-name`}>Your name</label>
          <input id={`${ids}-name`} autoComplete="given-name" maxLength={100} required value={name} onChange={(e) => setName(e.target.value)} />
        </>
      )}
      <label htmlFor={`${ids}-text`}>{replyTo ? "Your reply" : gift ? "Say something (optional)" : "What's happening?"}</label>
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
      {game.gifts.length > 0 && !replyTo && !gift && (
        <>
          <label htmlFor={`${ids}-gift`}>About a Gift? (optional)</label>
          <GiftSelect id={`${ids}-gift`} game={game} value={giftId} onChange={setGiftId} none="No, just the Chat" />
        </>
      )}
      {game.moderation === "approval" && <p className="muted hint">The Host approves each Post before others see it.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="inline">
        <button type="submit" disabled={sending || (!text.trim() && !photo) || (asks && !name.trim())}>
          {sending ? "Posting…" : "Post"}
        </button>
        {(text || photo || giftId !== (gift?.id ?? "")) && (
          <button type="button" className="secondary" disabled={sending} onClick={clear}>
            Clear
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Which Gift, from a dropdown. A big Game often has two of the same (two "Gift card"s, two "Ugly Sweater"s), so each
 * shows who holds it, "Ugly Sweater (Dana)", in A–Z order by Gift; or by holder, "Dana: Ugly Sweater", to find
 * the one a friend has.
 */
function GiftSelect({ id, game, value, onChange, none }: { id: string; game: GameView; value: string; onChange: (giftId: string) => void; none: string }) {
  const [byHolder, setByHolder] = useState(false);
  const holderOf = (holderId: string | null) => (holderId ? (game.players.find((p) => p.id === holderId)?.name ?? null) : null);
  const az = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  const gifts = game.gifts
    .map((g) => ({ id: g.id, gift: g.name, holder: holderOf(g.holderId) }))
    .sort((a, b) =>
      byHolder
        ? (a.holder === null ? 1 : 0) - (b.holder === null ? 1 : 0) || az(a.holder ?? "", b.holder ?? "") || az(a.gift, b.gift)
        : az(a.gift, b.gift) || az(a.holder ?? "", b.holder ?? ""),
    );
  return (
    <>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{none}</option>
        {gifts.map((g) => (
          <option key={g.id} value={g.id}>
            {g.holder === null ? g.gift : byHolder ? `${g.holder}: ${g.gift}` : `${g.gift} (${g.holder})`}
          </option>
        ))}
      </select>
      {gifts.length > 1 && (
        <button type="button" className="link gift-sort" onClick={() => setByHolder(!byHolder)}>
          {byHolder ? "Sort by Gift" : "Sort by holder"}
        </button>
      )}
    </>
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

/**
 * For the Host and Co-hosts: mutes whoever wrote a Post, so they can't post or reply (asking first, with the choice
 * to hide all their Posts too), or unmutes them, bringing back what the mute hid.
 */
function MuteButton({ gameId, post, onDone }: { gameId: string; post: Post; onDone: () => void }) {
  const api = useApi();
  const [asking, setAsking] = useState(false);
  const [hidePosts, setHidePosts] = useState(false);

  async function mute(muted: boolean, e?: FormEvent) {
    e?.preventDefault();
    if (await api.mute(gameId, post.id, muted, muted && hidePosts)) {
      setAsking(false);
      setHidePosts(false);
      onDone();
    }
  }

  if (post.authorMuted)
    return (
      <button type="button" className="link" aria-label={`Unmute ${post.author}`} onClick={() => void mute(false)}>
        🔊 Unmute
      </button>
    );
  if (!asking)
    return (
      <button type="button" className="link danger" aria-label={`Mute ${post.author}`} onClick={() => setAsking(true)}>
        🔇 Mute
      </button>
    );
  return (
    <form className="stack mute-form" aria-label={`Mute ${post.author}`} onSubmit={(e) => void mute(true, e)}>
      <p className="muted hint">{post.author} won't be able to post or reply in this Game until unmuted. They can still react.</p>
      <label className="check">
        <input type="checkbox" checked={hidePosts} onChange={(e) => setHidePosts(e.target.checked)} /> Also hide their posts
      </label>
      <div className="inline">
        <button type="submit" className="danger">
          Mute
        </button>
        <button type="button" className="secondary" onClick={() => setAsking(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * For a Post's poster, and the Host and Co-hosts: says which Gift it's about after posting (a great photo whose
 * poster didn't pick the Gift), so it shows under that Gift; or takes it off.
 */
function AttachToGift({ game, post, onDone }: { game: GameView; post: Post; onDone: () => void }) {
  const api = useApi();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [giftId, setGiftId] = useState(post.giftId ?? "");
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (await api.setPostGift(game.id, post.id, giftId || null)) {
      setOpen(false);
      setError(null);
      onDone();
    } else {
      setError("That didn't work. Please try again.");
    }
  }

  if (!open)
    return (
      <button
        type="button"
        className="link"
        onClick={() => {
          setGiftId(post.giftId ?? "");
          setOpen(true);
        }}
      >
        🎁 {post.giftId ? "Change gift" : "Attach to a gift"}
      </button>
    );
  return (
    <form className="stack reply-form" aria-label="Which gift is this about?" onSubmit={save}>
      <label htmlFor={`${ids}-gift`}>Which gift is this about?</label>
      <GiftSelect id={`${ids}-gift`} game={game} value={giftId} onChange={setGiftId} none="None, just the Chat" />
      <div className="inline">
        <button type="submit">Save</button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
