import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { SignInForm } from "./SignIn.js";

/** What a signed-out visitor sees at the app's home: what it's for, v1's three reasons, and the ways in. */
export function Landing() {
  return (
    <div className="stack landing">
      <section className="card landing-hero" aria-label="What it is">
        <p className="landing-lede">
          Run a big White Elephant gift swap from your phone, with the room following along on the TV and their own
          phones.
        </p>
        <p className="muted">
          Built for office parties and family reunions of 20, 50 or more, where the usual game turns into shouting
          across the room and drags on for hours. Free, with nothing to install.
        </p>
      </section>

      <div className="landing-points">
        <section className="card">
          <h3>⚡ Speed up the game</h3>
          <p>
            The TV shows every Gift, who holds it and how many Steals it has left. Nobody walks the room to see what's
            out there, and turns take seconds, not minutes.
          </p>
        </section>
        <section className="card">
          <h3>👀 Keep everyone in it</h3>
          <p>
            People at the back can't see a gift card from across the room. Guests post close-up Photos from their
            phones, star the Gifts they're after, and vote on the Worst Gift at the end.
          </p>
        </section>
        <section className="card">
          <h3>⚖️ The rules, kept for you</h3>
          <p>
            The Steal limit and No Take-Backs are enforced for you, and a Gift shows as Frozen once it can't be stolen.
            No more arguing over whether a gift is still in play.
          </p>
        </section>
      </div>

      <div className="landing-ways">
        <SignInForm heading="Host a Game" />
        <OpenGame />
      </div>

      <p className="landing-playbook">
        📖 Hosting for the first time? Read the <Link to="/playbook">Host's Playbook</Link>.
      </p>
      <TipJar />
    </div>
  );
}

/** Where tips go: a tip page, so nobody ever sees Jim's own accounts and nothing is ever paid back out. */
const TIP_URL = "https://ko-fi.com/jimwilley";

/**
 * Jim's ask, on the pages Hosts read (never in a Game, where guests are): a tip toward the paid email plan,
 * since sign-in emails are what runs out first (docs/scale-plan.md). No strings: nothing is bought.
 */
export function TipJar() {
  return (
    <section className="card tip-jar" aria-label="A note from Jim">
      <h3>A note from Jim</h3>
      <TipNoteText />
      <TipLink />
    </section>
  );
}

function TipNoteText() {
  return (
    <p>
      I built Elephant Exchange for my own holiday party, and I'm glad it's helping yours. It runs on my own small
      server, and the free email plan I'm on sends only 100 sign-in emails a day across the whole site. If your
      organization's party had fun with it, a $20 tip moves me to the paid email plan and keeps it running for everyone
      this season. No strings attached, and it's free either way.
    </p>
  );
}

function TipLink() {
  return (
    <a className="button" href={TIP_URL} target="_blank" rel="noopener noreferrer">
      ☕ Leave a tip
    </a>
  );
}

/**
 * The same note, shown when a Host starts a New Game until they tick that they've read and considered it.
 * `onContinue` says whether they ticked it; the New Game form follows either way.
 */
export function TipNoteDialog({ onContinue, onClose }: { onContinue: (read: boolean) => void; onClose: () => void }) {
  const [read, setRead] = useState(false);
  return (
    <div className="lc-overlay" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="A note from Jim" className="card lc-dialog tip-jar" onClick={(e) => e.stopPropagation()}>
        <h2>A note from Jim</h2>
        <TipNoteText />
        <TipLink />
        <label className="check">
          <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />
          I've read and considered this
        </label>
        <div className="inline">
          <button type="button" className="secondary" onClick={onClose}>
            Not now
          </button>
          <button type="button" onClick={() => onContinue(read)}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

/** v1's "Join Existing": a guest who has the Host's link or code but not the QR code goes straight to the Game. */
function OpenGame() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const id = gameIdFrom(text);

  function open(e: FormEvent) {
    e.preventDefault();
    if (id) navigate(`/games/${id}`);
  }

  return (
    <form className="card stack" aria-label="Open a Game" onSubmit={open}>
      <h2>Going to a party?</h2>
      <p className="muted">Scan the QR code on the TV, or paste the link your Host sent.</p>
      <label htmlFor="game-link">Game link or code</label>
      <input id="game-link" autoComplete="off" autoCapitalize="off" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
      <button type="submit" disabled={!id}>
        Open the Game
      </button>
    </form>
  );
}

/** A Game's id from its link (any page of it: the Game, its scoreboard) or from the id on its own. */
function gameIdFrom(text: string): string | null {
  const trimmed = text.trim();
  const fromLink = trimmed.match(/\/games\/([A-Za-z0-9_-]+)/);
  if (fromLink) return fromLink[1]!;
  return /^[A-Za-z0-9_-]{4,64}$/.test(trimmed) ? trimmed : null;
}

/** v1's Host's Playbook, brought up to date: how to run a smooth 20+ person exchange with this app. */
export function Playbook() {
  return (
    <article className="stack playbook">
      <Link to="/" className="back">
        ← Home
      </Link>
      <header>
        <h2>Host's Playbook</h2>
        <p className="muted">How to run a smooth exchange for 20 people or more.</p>
      </header>

      <section className="card">
        <h3>📋 Before the party</h3>
        <p>
          Start a Game and name it after your party. In its Settings, choose how many Players take a turn at once (two
          or three keeps a big group moving) and how many Steals Freeze a Gift. Three is the classic limit.
        </p>
        <p>
          Then get the names in. Paste the guest list straight from an email or a spreadsheet, one name per line; or let
          guests add themselves from their phones while they eat appetizers, by turning on sign-up in Settings and sending
          them the link.
        </p>
      </section>

      <section className="card">
        <h3>📺 The room</h3>
        <p>
          Put the scoreboard on a TV or projector the whole room can see. It's the flight board: who's up, who's on deck,
          every Gift, who holds it and how many Steals it has left. The quiet ones can plan their move without shouting
          across the room.
        </p>
        <p>
          Switch what it shows from your console: the Gifts, the rules (handy while people find their seats), a big QR
          code for joining, or a catalog of every Gift with its Photo.
        </p>
        <div className="tip">
          <strong>Tip:</strong> when someone opens something small or detailed, a gift card or a book, ask them to post a
          Photo from their phone. It's on the TV in seconds, and nobody at the back has to ask "what is that?"
        </div>
      </section>

      <section className="card">
        <h3>🎁 Running the Game</h3>
        <p>
          Players are drawn at random, and the next one is shown On Deck so they can get ready. For each Player who's up,
          open a Gift (type what's inside; you can add details or fix a typo later) or make a Steal. If someone stepped
          out, Skip them and they'll be called again later. Tapped the wrong thing? Undo takes back the last Pick.
        </p>
        <p>
          <strong>The Steal limit.</strong> A Gift is Frozen by the Steal that reaches the limit, and the Player who made
          it keeps it. Frozen Gifts sink to the bottom of the scoreboard.
        </p>
        <p>
          <strong>No take-backs.</strong> If Ann steals from Bob, Bob can't steal that Gift straight back. He steals
          something else or opens a new Gift. The app won't allow it, so there's nothing to argue about.
        </p>
        <p>
          <strong>The turn timer.</strong> In the middle turns a big game can stall. The timer (a minute by default) goes
          amber, then red. It's a friendly nudge, not a rule: the Player keeps their turn until you move on.
        </p>
        <p>
          <strong>The Final Round.</strong> Once everyone holds a Gift, the first few Players called get one last chance
          to steal, since they had little to steal from when they went. You choose how many.
        </p>
      </section>

      <section className="card">
        <h3>🗳️ The Worst Gift Vote</h3>
        <p>
          Every exchange has that one Gift: the singing fish, the creepy doll, the fruitcake. Instead of leaving its
          holder feeling stuck, make it a contest. After you end the Game, open the vote, and everyone votes from their
          phone for the worst Gift. Show the counts live on the TV, hide them until the reveal, or let every Gift parade
          past as a reminder.
        </p>
        <p>When you close the vote, the TV reveals the winner, the top five and a Photo of the winning Gift.</p>
        <div className="tip">
          <strong>Tip: the consolation prize.</strong> Keep one or two small, genuinely good gifts hidden, like chocolate
          or a gift card. The Worst Gift's holder picks a prize, so a loss becomes a win and the night ends on a laugh.
        </div>
      </section>

      <p>
        <Link to="/" className="button">
          Start a Game
        </Link>
      </p>
      <TipJar />
    </article>
  );
}
