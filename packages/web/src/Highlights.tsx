import { useEffect, useMemo, useState } from "react";
import type { GameView, Post } from "./api.js";

/** One thing worth seeing again: a Photo, something funny someone said, a Pitch's tagline, or a fact of the night. */
export type Highlight =
  | { kind: "photo"; key: string; url: string; caption: string | null; by: string; gift: string | null }
  | { kind: "quote"; key: string; text: string; by: string; gift: string | null; reactions: string }
  | { kind: "tagline"; key: string; tagline: string; by: string; gift: string }
  | { kind: "fact"; key: string; title: string; detail: string };

/** Funny means reacted to: the most Reactions first, and short enough to read from across the room. */
const MOST_QUOTES = 12;
const LONGEST_QUOTE = 200;

/** What the slideshow can show, from the Game and its Feed: only what everyone could already see. */
export function highlightsOf(game: GameView, posts: Post[]): Highlight[] {
  const giftName = (id: string | null) => game.gifts.find((g) => g.id === id)?.name ?? null;
  const shown = posts.filter((p) => p.status === "visible");
  const reactionCount = (p: Post) => p.reactions.reduce((n, r) => n + r.count, 0);

  const photos: Highlight[] = shown
    .filter((p) => p.photo)
    .map((p) => ({ kind: "photo", key: `photo-${p.id}`, url: p.photo!.url, caption: p.text || null, by: p.author, gift: giftName(p.giftId) }));
  const quotes: Highlight[] = shown
    .filter((p) => !p.photo && !p.pitchFor && p.text && p.text.length <= LONGEST_QUOTE)
    .sort((a, b) => reactionCount(b) - reactionCount(a))
    .slice(0, MOST_QUOTES)
    .map((p) => ({
      kind: "quote",
      key: `quote-${p.id}`,
      text: p.text,
      by: p.author,
      gift: giftName(p.giftId),
      reactions: [...p.reactions].sort((a, b) => b.count - a.count).slice(0, 3).map((r) => r.emoji).join(" "),
    }));
  const taglines: Highlight[] = shown
    .filter((p) => p.pitchFor && p.tagline && giftName(p.giftId))
    .map((p) => ({ kind: "tagline", key: `tagline-${p.id}`, tagline: p.tagline!, by: p.author, gift: giftName(p.giftId)! }));

  const facts: Highlight[] = [];
  const mostStolen = [...game.gifts].sort((a, b) => b.steals - a.steals)[0];
  if (mostStolen && mostStolen.steals > 0)
    facts.push({ kind: "fact", key: "most-stolen", title: mostStolen.name, detail: `Stolen ${mostStolen.steals} ${mostStolen.steals === 1 ? "time" : "times"}, the most of the night` });
  const worst = giftName(game.vote.status === "closed" ? game.vote.winner : null);
  if (worst) facts.push({ kind: "fact", key: "worst-gift", title: worst, detail: "Voted the Worst Gift" });
  if (game.gifts.length > 0)
    facts.push({ kind: "fact", key: "the-night", title: `${game.players.length} players · ${game.gifts.length} gifts`, detail: `${shown.length} posts and ${photos.length} photos` });

  return [...photos, ...quotes, ...taglines, ...facts];
}

/** Where a round's tiles go, on a 12-by-6 grid filling the screen; `big` slots go to Photos first. */
type Slot = { col: string; row: string; big?: boolean };
const LAYOUTS: Slot[][] = [
  [{ col: "1 / 8", row: "1 / 7", big: true }, { col: "8 / 13", row: "1 / 3" }, { col: "8 / 13", row: "3 / 5" }, { col: "8 / 13", row: "5 / 7" }],
  [{ col: "1 / 7", row: "1 / 4" }, { col: "7 / 13", row: "1 / 4", big: true }, { col: "1 / 7", row: "4 / 7", big: true }, { col: "7 / 13", row: "4 / 7" }],
  [{ col: "1 / 5", row: "1 / 7" }, { col: "5 / 9", row: "1 / 7", big: true }, { col: "9 / 13", row: "1 / 7" }],
  [{ col: "1 / 6", row: "1 / 4" }, { col: "1 / 6", row: "4 / 7" }, { col: "6 / 13", row: "1 / 7", big: true }],
];

/** For a screen taller than it's wide (a phone held upright): fewer, wider tiles, stacked on a 6-by-12 grid. */
const PORTRAIT_LAYOUTS: Slot[][] = [
  [{ col: "1 / 7", row: "1 / 8", big: true }, { col: "1 / 7", row: "8 / 13" }],
  [{ col: "1 / 7", row: "1 / 5" }, { col: "1 / 7", row: "5 / 13", big: true }],
  [{ col: "1 / 7", row: "1 / 5" }, { col: "1 / 7", row: "5 / 9", big: true }, { col: "1 / 7", row: "9 / 13" }],
  [{ col: "1 / 7", row: "1 / 7", big: true }, { col: "1 / 7", row: "7 / 10" }, { col: "1 / 7", row: "10 / 13" }],
];

const PORTRAIT = "(orientation: portrait)";

/** Whether the screen is taller than it's wide, following it as the phone turns. */
function usePortrait() {
  const [portrait, setPortrait] = useState(() => window.matchMedia?.(PORTRAIT).matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(PORTRAIT);
    if (!query) return;
    const follow = () => setPortrait(query.matches);
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);
  return portrait;
}

/** Fills a layout's slots from the deck: Photos into the big slots, anything into the rest. */
function fill(layout: Slot[], deck: Highlight[]): { slot: Slot; item: Highlight }[] {
  const left = [...deck];
  return layout.flatMap((slot) => {
    const i = slot.big ? Math.max(0, left.findIndex((h) => h.kind === "photo")) : 0;
    const [item] = left.splice(i, 1);
    return item ? [{ slot, item }] : [];
  });
}

const shuffled = <T,>(items: readonly T[], random: () => number): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

/** How long between tiles, how long a full round stays up, and how long it takes to clear (ms). */
const TILE_MS = 2400;
const HOLD_MS = 5000;
const CLEAR_MS = 800;

/**
 * The night's highlights on the big screen, once the Game is over: Photos, the funniest Posts, Pitch taglines and
 * a few facts, in random collages. Tiles slide in from either side, one at a time, and Photos slowly zoom; a full
 * screen holds, clears, and the next fills. When all have been shown, it shuffles and goes round again.
 */
export function Highlights({ game, posts, random = Math.random }: { game: GameView; posts: Post[]; random?: () => number }) {
  const all = highlightsOf(game, posts);
  const allKeys = all.map((h) => h.key).join(",");
  const [round, setRound] = useState(0);
  const [shownTiles, setShownTiles] = useState(1);
  const [clearing, setClearing] = useState(false);

  // A fresh order for each pass through everything; the same order while a pass lasts, even as the Feed refreshes.
  const [pass, setPass] = useState(0);
  const portrait = usePortrait();
  const layouts = portrait ? PORTRAIT_LAYOUTS : LAYOUTS;
  const deck = useMemo(() => shuffled(all, random), [allKeys, pass]);
  const rounds = useMemo(() => {
    const out: { slot: Slot; item: Highlight }[][] = [];
    let rest = deck;
    for (let i = 0; rest.length > 0; i++) {
      // A different first layout each pass, so even a quiet party's screen keeps changing shape.
      const layout = layouts[(i + pass) % layouts.length]!;
      // The last screen of a pass is topped up from the start, so it's never half empty (nothing twice on one screen).
      const pool = rest.length >= layout.length ? rest : [...rest, ...deck.filter((h) => !rest.includes(h))];
      const tiles = fill(layout, pool);
      const used = new Set(tiles.map((t) => t.item.key));
      rest = rest.filter((h) => !used.has(h.key));
      out.push(tiles);
    }
    return out;
  }, [deck, pass, layouts]);
  const tiles = rounds[round % Math.max(1, rounds.length)] ?? [];

  useEffect(() => {
    if (tiles.length === 0) return;
    const next =
      shownTiles < tiles.length
        ? setTimeout(() => setShownTiles((n) => n + 1), TILE_MS)
        : clearing
          ? setTimeout(() => {
              setClearing(false);
              setShownTiles(1);
              if (round + 1 >= rounds.length) {
                setRound(0);
                setPass((p) => p + 1);
              } else setRound(round + 1);
            }, CLEAR_MS)
          : setTimeout(() => setClearing(true), HOLD_MS);
    return () => clearTimeout(next);
  }, [tiles.length, shownTiles, clearing, round, rounds.length]);

  if (all.length === 0) {
    return (
      <section className="card now highlights-empty" aria-label="Highlights">
        <p className="big">Highlights</p>
        <p className="muted">Photos and Posts from the Feed will show here. Nobody posted this time.</p>
      </section>
    );
  }

  return (
    <section className="highlights" aria-label="Highlights">
      {/* For a screen reader: everything, as a list, rather than tiles coming and going. */}
      <ul className="visually-hidden" aria-label="All highlights">
        {all.map((h) => (
          <li key={h.key}>{describe(h)}</li>
        ))}
      </ul>
      <div className={["highlights-grid", portrait && "portrait", clearing && "clearing"].filter(Boolean).join(" ")} aria-hidden="true">
        {tiles.slice(0, shownTiles).map(({ slot, item }, i) => (
          <div key={`${round}-${pass}-${item.key}`} className={`hl-tile hl-${item.kind} ${i % 2 === 0 ? "from-left" : "from-right"}`} style={{ gridColumn: slot.col, gridRow: slot.row }}>
            <Tile item={item} />
          </div>
        ))}
      </div>
    </section>
  );
}

function Tile({ item }: { item: Highlight }) {
  switch (item.kind) {
    case "photo":
      return (
        <>
          <img src={item.url} alt="" />
          <p className="hl-caption">
            {item.caption && <span>{item.caption}</span>}
            <span className="hl-by">
              {item.by}
              {item.gift && ` · ${item.gift}`}
            </span>
          </p>
        </>
      );
    case "quote":
      return (
        <>
          <p className="hl-quote">“{item.text}”</p>
          <p className="hl-by">
            {item.by}
            {item.gift && ` · about ${item.gift}`} {item.reactions && <span className="hl-reactions">{item.reactions}</span>}
          </p>
        </>
      );
    case "tagline":
      return (
        <>
          <p className="hl-label">🎤 {item.gift}</p>
          <p className="hl-tagline">{item.tagline}</p>
          <p className="hl-by">{item.by}'s pitch</p>
        </>
      );
    case "fact":
      return (
        <>
          <p className="hl-fact">{item.title}</p>
          <p className="hl-detail">{item.detail}</p>
        </>
      );
  }
}

function describe(h: Highlight): string {
  switch (h.kind) {
    case "photo":
      return `Photo from ${h.by}${h.gift ? ` of ${h.gift}` : ""}${h.caption ? `: ${h.caption}` : ""}`;
    case "quote":
      return `${h.by}: “${h.text}”`;
    case "tagline":
      return `${h.by}'s pitch for ${h.gift}: ${h.tagline}`;
    case "fact":
      return `${h.title}: ${h.detail}`;
  }
}
