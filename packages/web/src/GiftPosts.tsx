import { useEffect, useRef, useState } from "react";
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
  return (
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
    </div>
  );
}
