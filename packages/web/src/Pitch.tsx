import { useEffect, useId, useState, type FormEvent } from "react";
import type { GameView, Post } from "./api.js";
import { useApi } from "./ApiContext.js";
import { useServerTime } from "./Countdown.js";
import { PostPhoto } from "./Feed.js";
import { shrinkPhoto } from "./shrinkPhoto.js";

/**
 * A Gift's Pitch parts, newest first: each holder's own part, kept as the Gift is stolen. By when each was written,
 * not by the Feed's order, since a part sent to the top of the Feed again stays where it was in the Gift's story.
 */
export const pitchOf = (posts: Post[], giftId: string) =>
  posts.filter((p) => p.giftId === giftId && p.pitchFor !== null).sort((a, b) => b.createdAt - a.createdAt);
/** Posts about a Gift that aren't its Pitch: its Photos and what people said. */
export const aboutGift = (posts: Post[], giftId: string) => posts.filter((p) => p.giftId === giftId && p.pitchFor === null);

/** When a part may next be sent to the top of the Feed (ms since 1970). */
const nextRepitch = (part: Post, minutes: number) => (part.bumpedAt ?? part.createdAt) + minutes * 60_000;

/**
 * Under a Gift: its Pitch, the story its holders tell to tempt a Steal ("a priceless family heirloom") or to fend
 * one off ("trust me, you don't want this"). Each part has an eye-catching tagline, the story and a Photo, any of
 * them. The holder writes their part while they hold it, and may change or remove it later, and send it to the top
 * of the Feed again now and then; the Host and Co-hosts may write the holder's part for them (a guest without a
 * phone) and change any part. With `reload`, it offers the writing; without, it only shows.
 */
export function GiftPitch({
  game,
  gift,
  posts,
  reload,
}: {
  game: GameView;
  gift: { id: string; name: string; holderId: string | null };
  posts: Post[];
  reload?: (() => void) | undefined;
}) {
  const api = useApi();
  const [editing, setEditing] = useState<string | null>(null); // the Player whose part is being written
  const [note, setNote] = useState<string | null>(null);
  const parts = pitchOf(posts, gift.id);
  const hosting = game.role !== null;
  const me = game.me?.playerId ?? null;
  const nameOf = (playerId: string) => game.players.find((p) => p.id === playerId)?.name ?? "?";
  const mayWrite = reload !== undefined && (hosting || (game.phase !== "ended" && game.moderation !== "paused" && !game.muted));
  const mayEdit = (playerId: string) => mayWrite && (hosting || playerId === me);
  const holder = gift.holderId;
  const offerNew = mayWrite && game.phase !== "ended" && holder !== null && (hosting || holder === me) && !parts.some((p) => p.pitchFor === holder);
  useRedrawEvery(15_000); // for "Again in 3 min" to count down
  const now = useServerTime(game.clock.now)(); // the server's clock: a phone set a few minutes wrong still agrees

  async function save(playerId: string, change: PitchChange) {
    const result = await api.setPitch(game.id, gift.id, change, hosting && playerId !== me ? playerId : undefined);
    if (result === "saved") {
      setEditing(null);
      reload?.();
    }
    return result;
  }

  async function again(part: Post) {
    const result = await api.repitch(game.id, gift.id, hosting && part.pitchFor !== me ? part.pitchFor! : undefined);
    if (result === "sent") {
      setNote("Sent to the top of the Chat.");
      reload?.();
    } else setNote(result === "failed" ? "That didn't work. Please try again." : `You can pitch it again in ${Math.ceil(result.wait / 60)} min.`);
  }

  if (parts.length === 0 && !offerNew) return null;
  return (
    <div className="pitch">
      {parts.length > 0 && (
        <ul className="pitch-parts" aria-label={`Pitch for ${gift.name}`}>
          {parts.map((p) => {
            const label = `${p.author}'s pitch for ${gift.name}`;
            if (editing === p.pitchFor) {
              return (
                <li key={p.id}>
                  <PitchForm label={label} part={p} onCancel={() => setEditing(null)} onSave={(change) => save(p.pitchFor!, change)} />
                </li>
              );
            }
            // Only the holder's current part goes back to the top: an old holder's part is history.
            const canAgain = mayWrite && p.status === "visible" && p.pitchFor === holder && (hosting || holder === me) && game.phase !== "ended";
            const waitUntil = nextRepitch(p, game.repitchMinutes);
            return (
              <li key={p.id}>
                {p.tagline && <span className="pitch-tagline">{p.tagline}</span>}
                <span>
                  🎤 <strong>{p.author}</strong>
                  {p.text && <>: {p.text}</>}
                </span>
                {p.photo && <PostPhoto post={p} className="pitch-photo" />}
                {p.status === "pending" && <span className="badge">Waiting for approval</span>}
                {p.status === "hidden" && <span className="badge">Hidden</span>}
                <span className="pitch-actions">
                  {mayEdit(p.pitchFor!) && (
                    <button type="button" className="link" aria-label={`Edit ${label}`} onClick={() => setEditing(p.pitchFor)}>
                      Edit
                    </button>
                  )}
                  {canAgain &&
                    (hosting || now >= waitUntil ? (
                      <button type="button" className="link" aria-label={`Pitch ${gift.name} again`} onClick={() => void again(p)}>
                        📣 Pitch it again
                      </button>
                    ) : (
                      <span className="muted">📣 Again in {Math.ceil((waitUntil - now) / 60_000)} min</span>
                    ))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {note && (
        <p className="muted hint" role="status">
          {note}
        </p>
      )}
      {offerNew &&
        (editing === holder ? (
          <PitchForm
            label={holder === me ? `Your pitch for ${gift.name}` : `${nameOf(holder)}'s pitch for ${gift.name}`}
            onCancel={() => setEditing(null)}
            onSave={(change) => save(holder, change)}
          />
        ) : (
          <button type="button" className="link" onClick={() => setEditing(holder)}>
            🎤 {holder === me ? "Pitch it" : `Pitch it for ${nameOf(holder)}`}
          </button>
        ))}
    </div>
  );
}

/** Redraws whatever uses it every `ms`. */
function useRedrawEvery(ms: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(timer);
  }, [ms]);
}

type PitchChange = { tagline: string; text: string; photo?: Blob; removePhoto?: boolean };

const saveErrors = {
  notPhoto: "That doesn't look like a photo we can use. Try another?",
  tooBig: "That Photo is too big to send. Try another?",
  unshrinkable: "This photo couldn't be made smaller on this phone. Try a screenshot of it instead.",
  failed: "That didn't save. Please try again.",
};

function PitchForm({
  label,
  part,
  onSave,
  onCancel,
}: {
  label: string;
  part?: Post;
  onSave: (change: PitchChange) => Promise<"saved" | "notPhoto" | "tooBig" | "failed">;
  onCancel: () => void;
}) {
  const ids = useId();
  const [tagline, setTagline] = useState(part?.tagline ?? "");
  const [text, setText] = useState(part?.text ?? "");
  const [photo, setPhoto] = useState<File | null>(null);
  const [dropPhoto, setDropPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasOldPhoto = Boolean(part?.photo) && !dropPhoto;
  const empty = !tagline.trim() && !text.trim() && !photo && !hasOldPhoto;

  async function send(change: PitchChange) {
    setSaving(true);
    const result = await onSave(change);
    setSaving(false);
    setError(result === "saved" ? null : saveErrors[result]);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    // Shrunk on the phone, never sent full size (see shrinkPhoto).
    const shrunk = photo ? await shrinkPhoto(photo).catch(() => null) : undefined;
    if (shrunk === null) return setError(saveErrors.unshrinkable);
    await send({ tagline: tagline.trim(), text: text.trim(), ...(shrunk ? { photo: shrunk } : {}), ...(dropPhoto && !shrunk ? { removePhoto: true } : {}) });
  }

  return (
    <form className="stack pitch-form" aria-label={label} onSubmit={save}>
      <p className="muted hint">Tempt someone to steal it, or tell everyone why they really shouldn't.</p>
      <label htmlFor={`${ids}-tagline`}>Tagline (a bold headline)</label>
      <input
        id={`${ids}-tagline`}
        maxLength={80}
        autoComplete="off"
        placeholder="A TRUE FAMILY HEIRLOOM"
        value={tagline}
        onChange={(e) => setTagline(e.target.value)}
      />
      <label htmlFor={`${ids}-text`}>The pitch</label>
      <textarea id={`${ids}-text`} rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
      {photo ? (
        <button type="button" className="link danger" onClick={() => setPhoto(null)}>
          Don't add this photo
        </button>
      ) : hasOldPhoto ? (
        <button type="button" className="link danger" onClick={() => setDropPhoto(true)}>
          Remove the photo
        </button>
      ) : (
        <>
          <label htmlFor={`${ids}-photo`} className="photo-pick">
            Add a photo
          </label>
          <input
            id={`${ids}-photo`}
            type="file"
            accept="image/*"
            className="visually-hidden"
            onChange={(e) => {
              setPhoto(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </>
      )}
      {photo && <p className="muted hint">Photo chosen: {photo.name}</p>}
      <div className="inline">
        <button type="submit" disabled={saving || empty}>
          Save
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        {part && (
          <button type="button" className="link danger" disabled={saving} onClick={() => void send({ tagline: "", text: "", removePhoto: true })}>
            Remove this pitch
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
