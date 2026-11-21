import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { BUSY_MESSAGE, ServerBusy, type Api, type Emoji } from "./api.js";
import { useApi } from "./ApiContext.js";
import giftTable from "./assets/demo-gift-table.webp";
import { useLiveGame } from "./useLiveGame.js";

/** Made-up Players for a demo Game: enough for the largest demo, all different. */
const demoNames = [
  "Ann", "Ben", "Cat", "Dev", "Eve", "Finn", "Gus", "Hana", "Ivan", "Jade",
  "Kai", "Lena", "Max", "Nia", "Omar", "Pia", "Quinn", "Rosa", "Sam", "Tess",
  "Uma", "Vic", "Wren", "Xavi", "Yara", "Zed", "Abe", "Bea", "Cole", "Dina",
  "Eli", "Fay", "Gabe", "Holly", "Ike", "Joy", "Kit", "Lou", "Mia", "Ned",
  "Ola", "Pete", "Rae", "Stan", "Tara", "Ugo", "Val", "Will", "Yoko", "Zoe",
];
export const MAX_DEMO_PLAYERS = demoNames.length;

/**
 * A Game to show the app off with: the usual settings and as many made-up Players as asked for, so the Host can
 * press Start straight away. Guests can still join on their phones, and gifts are typed in as in any Game.
 */
export function DemoGame({ startOpen = false }: { startOpen?: boolean }) {
  const api = useApi();
  const navigate = useNavigate();
  const [open, setOpen] = useState(startOpen);
  const [players, setPlayers] = useState("8");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  if (!open) {
    return (
      <button className="secondary" onClick={() => setOpen(true)}>
        Try a demo game
      </button>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      // No sign-in needed: someone not signed in gets a stand-in session for demo Games.
      await api.startVisitor();
      const id = await api.createGame({ name: "Demo game", options: { ...RECOMMENDED_OPTIONS, rosterMode: "self" }, demo: true });
      const playerIds: string[] = [];
      for (const name of shuffled(demoNames).slice(0, Number(players))) {
        const playerId = crypto.randomUUID();
        await api.command(id, { type: "AddPlayer", playerId, name });
        playerIds.push(playerId);
      }
      await chatter(api, id, playerIds);
      // On a screen wide enough for it, the demo page shows the Host console, the scoreboard and a phone together.
      navigate(window.matchMedia?.(WIDE_ENOUGH).matches ? `/games/${id}/demo` : `/games/${id}`);
    } catch (e) {
      setFailed(e instanceof ServerBusy ? BUSY_MESSAGE : "The demo couldn't be created. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Demo game</h2>
      <p className="muted">A practice Game with made-up Players, ready to start. Type in any gifts you like.</p>
      <label htmlFor="demo-players">How many players?</label>
      <input
        id="demo-players"
        type="number"
        inputMode="numeric"
        min={2}
        max={MAX_DEMO_PLAYERS}
        required
        value={players}
        onChange={(e) => setPlayers(e.target.value)}
      />
      {failed && (
        <p className="error" role="alert">
          {failed}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create demo game"}
      </button>
    </form>
  );
}

/**
 * What a demo's guests have said before it starts, so its Feed isn't empty: a Photo of the gift table, a joke, a
 * reply and some Reactions. The sample phone (the first Player's) then shows new Posts on its Feed tab, and the
 * scoreboard has some to show. Only a nice-to-have: whatever doesn't work is left out, and the demo goes on.
 */
async function chatter(api: Api, gameId: string, playerIds: string[]) {
  const guests = playerIds.slice(1); // not the sample phone's own Player, whose new Posts these are
  if (guests.length === 0) return;
  const guest = (i: number) => api.as(guests[i % guests.length]!);
  const photo = await fetch(giftTable)
    .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`${res.status}`))))
    .then((bytes) => new Blob([bytes], { type: "image/webp" }))
    .catch(() => undefined);
  /** Says it as that guest, and finds the new Post (the server doesn't say which it is). */
  const say = async (i: number, text: string, more: { photo?: Blob; replyTo?: string } = {}) => {
    if ((await guest(i).post(gameId, { text, ...more }).catch(() => "failed")) !== "posted") return undefined;
    const theirs = (await guest(i).posts(gameId).catch(() => [])).filter((p) => p.mine && p.text === text);
    return theirs.at(-1)?.id;
  };
  const react = (i: number, postId: string | undefined, emoji: Emoji) => postId && guest(i).react(gameId, postId, emoji, true).catch(() => false);

  try {
    const table = await say(0, "The gift table is getting serious 👀", photo ? { photo } : {});
    await react(1, table, "😂");
    await react(2, table, "🔥");
    const tape = await say(1, "Whoever wrapped a box in duct tape: respect.");
    await react(2, tape, "😂");
    await react(3, tape, "😂");
    const mine = await say(2, "That's mine. Good luck getting into it 😈", tape ? { replyTo: tape } : {});
    await react(0, mine, "😂");
    const snowman = await say(3, "Fair warning: I'm stealing anything with a snowman on it ⛄");
    await react(0, snowman, "🎉");
  } catch {
    // The demo works without it.
  }
}

/** Wide enough for the demo page's console beside its sample phone. */
const WIDE_ENOUGH = "(min-width: 1000px)";

type DemoTab = "console" | "screen";

/**
 * A demo Game seen from every side at once: the Host console (or the live scoreboard) on the left and, on the right,
 * a phone that is one of the made-up Players. Each is the real page in a frame, so everything on it works; the phone
 * acts as its Player (the server allows that only in a demo Game, and only for its Hosts).
 */
export function DemoPage() {
  const { id = "" } = useParams();
  const [game] = useLiveGame(id);
  const [tab, setTab] = useState<DemoTab>("console");
  const [chosen, setChosen] = useState<string | null>(null);

  if (game === "loading") return <p className="muted">Loading…</p>;
  if (!game) return <p className="error">There's no Game at this link.</p>;
  if (game.role === null) return <p className="error">Only the Host of a demo game can open its demo page.</p>;

  const phonePlayer = game.players.find((p) => p.id === chosen) ?? game.players[0];
  // Each at the size it's made for, shrunk to fit: the console as on a laptop, the scoreboard as on a TV.
  const tabs: { id: DemoTab; label: string; src: string; width: number }[] = [
    { id: "console", label: "Host console", src: `/games/${id}`, width: LAPTOP_WIDTH },
    { id: "screen", label: "Live scoreboard", src: `/games/${id}/screen`, width: TV_WIDTH },
  ];

  return (
    <div className="demo">
      <section className="demo-main" aria-label="Host">
        <div className="demo-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" id={`demo-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`demo-${t.id}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {/* Both stay loaded, so switching is instant and each keeps its place. */}
        {tabs.map((t) => (
          <ScaledFrame key={t.id} width={t.width} id={`demo-${t.id}`} role="tabpanel" aria-labelledby={`demo-tab-${t.id}`} title={t.label} src={t.src} hidden={tab !== t.id} />
        ))}
        <p className="muted hint">
          Run the game here; the scoreboard and the phone follow along. <Link to={`/games/${id}`}>Open the Host console on its own</Link>
        </p>
      </section>

      <section className="demo-phone" aria-label="Phone">
        {phonePlayer ? (
          <>
            <label htmlFor="demo-phone-player">Phone of</label>
            <select id="demo-phone-player" value={phonePlayer.id} onChange={(e) => setChosen(e.target.value)}>
              {game.players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {/* A new frame for each Player: the phone starts afresh, as theirs. */}
            <iframe key={phonePlayer.id} title={`${phonePlayer.name}'s phone`} src={`/games/${id}?demoPlayer=${encodeURIComponent(phonePlayer.id)}`} />
            <p className="muted hint">
              Try the 💬 Chat: post a Photo and watch it land on the big screen. Or add a Photo to a Gift once it's opened.
            </p>
          </>
        ) : (
          <p className="muted">Add a player to see their phone.</p>
        )}
      </section>
    </div>
  );
}

/** How wide the Host console is drawn in the demo: a laptop's, so it's the two-column console (GamePage's WIDE). */
const LAPTOP_WIDTH = 1060;
/** How wide the scoreboard is drawn in the demo: a TV's proportions. */
const TV_WIDTH = 1280;

/**
 * A page in a frame drawn at least `width` wide, then shrunk to fit the space it has, like a screenshot. So a laptop
 * window too narrow for both the console and the phone still shows the console the way a Host will see it on their
 * laptop, not the phone's single column.
 */
function ScaledFrame({ width, hidden, ...frame }: { width: number; hidden: boolean; id: string; role: string; title: string; src: string; "aria-labelledby": string }) {
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watcher = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry!.contentRect;
      if (w > 0 && h > 0) setRoom({ w, h }); // a hidden tab measures nothing; keep its last size
    });
    watcher.observe(el);
    return () => watcher.disconnect();
  }, []);
  const scale = room ? Math.min(1, room.w / width) : 1;
  const shrunk = room && scale < 1 ? { width, height: room.h / scale, transform: `scale(${scale})` } : undefined;
  return (
    <div ref={box} className="scaled-frame" hidden={hidden}>
      <iframe {...frame} hidden={hidden} style={shrunk} />
    </div>
  );
}

function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
