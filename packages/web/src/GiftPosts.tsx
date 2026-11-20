import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Post } from "./api.js";
import { PostPhoto } from "./Feed.js";

/**
 * Every Post about one Gift, one at a time, newest first: its Photo full width and what was said. Paged with the
 * buttons or a swipe, closed with ✕ or Escape. So someone who missed the open can see what it is (and who's grinning
 * or frowning about it) without walking over.
 */
export function GiftPostsViewer({ giftName, posts, onClose }: { giftName: string; posts: Post[]; onClose: () => void }) {
  const [at, setAt] = useState(0);
  const close = useRef<HTMLButtonElement>(null);
  const swipeFrom = useRef<number | null>(null);
  const last = posts.length - 1;
  const index = Math.min(at, last);
  const post = posts[index];

  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setAt((i) => Math.min(i + 1, last));
      if (e.key === "ArrowLeft") setAt((i) => Math.max(i - 1, 0));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, last]);

  if (!post) return null;
  // On the page itself, not inside the list that opened it, so it takes none of that list's styles.
  return createPortal(
    <div className="viewer-backdrop" onClick={onClose}>
      <div
        className="viewer card"
        role="dialog"
        aria-modal="true"
        aria-label={`Posts about ${giftName}`}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => (swipeFrom.current = e.touches[0]?.clientX ?? null)}
        onTouchEnd={(e) => {
          const from = swipeFrom.current;
          const to = e.changedTouches[0]?.clientX;
          swipeFrom.current = null;
          if (from === null || to === undefined || Math.abs(to - from) < 40) return;
          setAt(to < from ? Math.min(index + 1, last) : Math.max(index - 1, 0));
        }}
      >
        <div className="viewer-top">
          <h2>{giftName}</h2>
          <button ref={close} type="button" className="link" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <PostPhoto post={post} className="viewer-photo" />
        <p>
          <strong>{post.author}</strong>
          {post.text && `: ${post.text}`}
        </p>
        <div className="viewer-nav">
          <button type="button" className="secondary" aria-label="Previous" disabled={index === 0} onClick={() => setAt(index - 1)}>
            ‹
          </button>
          <span className="muted">
            {index + 1} of {posts.length}
          </span>
          <button type="button" className="secondary" aria-label="Next" disabled={index === last} onClick={() => setAt(index + 1)}>
            ›
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * For the laptop's Gift Tracker: a Gift's newest Photo as a small thumbnail and how many Posts are about it, either
 * of which opens them all. Nothing when there are none.
 */
export function GiftMedia({ giftName, posts }: { giftName: string; posts: Post[] }) {
  const [open, setOpen] = useState(false);
  const photo = posts.find((p) => p.photo);
  if (posts.length === 0) return <span className="lc-gift-media" />;
  const label = posts.length === 1 ? `See the post about ${giftName}` : `See all ${posts.length} posts about ${giftName}`;
  return (
    <span className="lc-gift-media">
      {photo && (
        <button type="button" className="gift-thumb" aria-label={`Photos of ${giftName}`} onClick={() => setOpen(true)}>
          <PostPhoto post={photo} className="lc-gift-photo" />
        </button>
      )}
      <button type="button" className="secondary gift-count" aria-label={label} onClick={() => setOpen(true)}>
        📷 {posts.length}
      </button>
      {open && <GiftPostsViewer giftName={giftName} posts={posts} onClose={() => setOpen(false)} />}
    </span>
  );
}
