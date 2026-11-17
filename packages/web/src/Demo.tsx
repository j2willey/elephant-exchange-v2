import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useApi } from "./ApiContext.js";

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
      navigate(`/games/${id}`);
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

function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
