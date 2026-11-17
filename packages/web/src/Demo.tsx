import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useApi } from "./ApiContext.js";
import { useLiveGame } from "./useLiveGame.js";

/** Made-up Players for a demo Game: enough for the largest demo, all different. */
const demoNames = [
  "Ann", "Ben", "Cat", "Dev", "Eve", "Finn", "Gus", "Hana", "Ivan", "Jade",
  "Kai", "Lena", "Max", "Nia", "Omar", "Pia", "Quinn", "Rosa", "Sam", "Tess",
  "Uma", "Vic", "Wren", "Xavi", "Yara", "Zed", "Abe", "Bea", "Cole", "Dina",
  "Eli", "Fay", "Gabe", "Holly", "Ike", "Joy", "Kit", "Lou", "Mia", "Ned",
];
export const MAX_DEMO_PLAYERS = demoNames.length;

/**
 * A Game to show the app off with: the usual settings and as many made-up Players as asked for, so the Host can
 * press Start straight away. Guests can still join on their phones, and gifts are typed in as in any Game.
 */
export function DemoGame() {
  const api = useApi();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [players, setPlayers] = useState("8");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

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
      const id = await api.createGame({ activeSlots: 1, maxSteals: 3 }, "Demo game", "self", 60, undefined, true);
      for (const name of shuffled(demoNames).slice(0, Number(players))) {
        await api.command(id, { type: "AddPlayer", playerId: crypto.randomUUID(), name });
      }
      // On a screen wide enough for it, the demo page shows the Host console, the scoreboard and a phone together.
      navigate(window.matchMedia?.(WIDE_ENOUGH).matches ? `/games/${id}/demo` : `/games/${id}`);
    } catch {
      setFailed(true);
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
          The demo couldn't be created. Please try again.
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create demo game"}
      </button>
    </form>
  );
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
  const tabs: { id: DemoTab; label: string; src: string }[] = [
    { id: "console", label: "Host console", src: `/games/${id}` },
    { id: "screen", label: "Live scoreboard", src: `/games/${id}/screen` },
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
          <iframe key={t.id} id={`demo-${t.id}`} role="tabpanel" aria-labelledby={`demo-tab-${t.id}`} title={t.label} src={t.src} hidden={tab !== t.id} />
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
          </>
        ) : (
          <p className="muted">Add a player to see their phone.</p>
        )}
      </section>
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
