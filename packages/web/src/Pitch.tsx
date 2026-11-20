import { useState, type FormEvent } from "react";
import type { GameView, Post } from "./api.js";
import { useApi } from "./ApiContext.js";

/** A Gift's Pitch parts, newest first (Posts come newest first): each holder's own part, kept as the Gift is stolen. */
export const pitchOf = (posts: Post[], giftId: string) => posts.filter((p) => p.giftId === giftId && p.pitchFor !== null);
/** Posts about a Gift that aren't its Pitch: its Photos and what people said. */
export const aboutGift = (posts: Post[], giftId: string) => posts.filter((p) => p.giftId === giftId && p.pitchFor === null);

/**
 * Under a Gift: its Pitch, the story its holders tell to tempt a Steal ("a priceless family heirloom") or to fend
 * one off ("trust me, you don't want this"). The holder writes their part while they hold it, and may change or
 * remove it later; the Host and Co-hosts may write the holder's part for them (a guest without a phone) and change
 * any part. With `reload`, it offers the writing; without, it only shows.
 */
export function GiftPitch({ game, gift, posts, reload }: { game: GameView; gift: { id: string; name: string; holderId: string | null }; posts: Post[]; reload?: (() => void) | undefined }) {
  const api = useApi();
  const [editing, setEditing] = useState<string | null>(null); // the Player whose part is being written
  const parts = pitchOf(posts, gift.id);
  const hosting = game.role !== null;
  const me = game.me?.playerId ?? null;
  const nameOf = (playerId: string) => game.players.find((p) => p.id === playerId)?.name ?? "?";
  const mayWrite = reload !== undefined && (hosting || (game.phase !== "ended" && game.moderation !== "paused" && !game.muted));
  const mayEdit = (playerId: string) => mayWrite && (hosting || playerId === me);
  const holder = gift.holderId;
  const offerNew = mayWrite && game.phase !== "ended" && holder !== null && (hosting || holder === me) && !parts.some((p) => p.pitchFor === holder);

  if (parts.length === 0 && !offerNew) return null;
  return (
    <div className="pitch">
      {parts.length > 0 && (
        <ul className="pitch-parts" aria-label={`Pitch for ${gift.name}`}>
          {parts.map((p) =>
            editing === p.pitchFor ? (
              <li key={p.id}>
                <PitchForm
                  label={`${p.author}'s pitch for ${gift.name}`}
                  initial={p.text}
                  onCancel={() => setEditing(null)}
                  onSave={async (text) => {
                    if (await api.setPitch(game.id, gift.id, text, hosting ? p.pitchFor! : undefined)) {
                      setEditing(null);
                      reload?.();
                      return true;
                    }
                    return false;
                  }}
                />
              </li>
            ) : (
              <li key={p.id}>
                🎤 <strong>{p.author}</strong>: {p.text}
                {p.status === "pending" && <span className="badge">Waiting for approval</span>}
                {p.status === "hidden" && <span className="badge">Hidden</span>}
                {mayEdit(p.pitchFor!) && (
                  <button type="button" className="link" aria-label={`Edit ${p.author}'s pitch for ${gift.name}`} onClick={() => setEditing(p.pitchFor)}>
                    Edit
                  </button>
                )}
              </li>
            ),
          )}
        </ul>
      )}
      {offerNew &&
        (editing === holder ? (
          <PitchForm
            label={holder === me ? `Your pitch for ${gift.name}` : `${nameOf(holder)}'s pitch for ${gift.name}`}
            initial=""
            onCancel={() => setEditing(null)}
            onSave={async (text) => {
              if (await api.setPitch(game.id, gift.id, text, hosting && holder !== me ? holder : undefined)) {
                setEditing(null);
                reload?.();
                return true;
              }
              return false;
            }}
          />
        ) : (
          <button type="button" className="link" onClick={() => setEditing(holder)}>
            🎤 {holder === me ? "Pitch it" : `Pitch it for ${nameOf(holder)}`}
          </button>
        ))}
    </div>
  );
}

function PitchForm({ label, initial, onSave, onCancel }: { label: string; initial: string; onSave: (text: string) => Promise<boolean>; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const [failed, setFailed] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setFailed(!(await onSave(text.trim())));
  }
  return (
    <form className="stack pitch-form" aria-label={label} onSubmit={save}>
      <textarea aria-label={label} rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
      <p className="muted hint">Tempt someone to steal it, or tell everyone why they really shouldn't. Up to 500 characters.</p>
      <div className="inline">
        <button type="submit" disabled={!text.trim() && !initial}>
          {text.trim() || !initial ? "Save" : "Remove"}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        {initial && text.trim() && (
          <button type="button" className="link danger" onClick={() => void onSave("").then((ok) => setFailed(!ok))}>
            Remove
          </button>
        )}
      </div>
      {failed && (
        <p className="error" role="alert">
          That didn't save. Please try again.
        </p>
      )}
    </form>
  );
}
