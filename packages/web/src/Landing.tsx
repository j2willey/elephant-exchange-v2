import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import scoreboard from "./assets/scoreboard.webp";
import { SignInForm } from "./SignIn.js";

/**
 * The front page: what Elephant Exchange is, the problem it solves, how it helps and how it works, with the ways
 * in at the top and again at the end. A signed-out visitor sees it at /; anyone can open it at /about, where a
 * signed-in Host is pointed back to their Games instead of asked to sign in.
 */
export function Landing({ signedIn = false }: { signedIn?: boolean }) {
  const ways = (
    <div className="landing-ctas">
      <Link to="/try" className="button">
        ▶ Try the demo
      </Link>
      {signedIn ? (
        <Link to="/" className="button secondary-button">
          Your Games →
        </Link>
      ) : (
        <a href="#host" className="button secondary-button">
          Host a Game
        </a>
      )}
    </div>
  );

  return (
    <div className="stack landing">
      <section className="landing-hero" aria-label="What it is">
        <p className="landing-tagline">The White Elephant gift swap that keeps the whole room in the game.</p>
        <p className="landing-lede">
          Run your party's gift exchange from a laptop or a phone. Every opened gift, who has it and how many times it's
          been stolen goes up on the TV, and everyone follows along on their own phone.
        </p>
        {ways}
        <p className="landing-party-link">
          Going to a party? <a href="#join">Enter your code</a>
        </p>
        <figure className="landing-shot">
          <img src={scoreboard} width={1280} height={720} alt="The scoreboard on the party's TV: who's up now and on deck, every gift with its holder and steals, the latest posts, and a QR code for guests" />
          <figcaption className="muted">The scoreboard on the party's TV.</figcaption>
        </figure>
      </section>

      <section className="card landing-problem" aria-label="Sound familiar?">
        <h2>Sound familiar?</h2>
        <p>Fifty people, a pile of wrapped gifts and a rule everyone remembers differently. Two hours later you're on turn thirty.</p>
        <ul>
          <li>Every turn, someone wanders the room asking who has what before they decide whether to steal.</li>
          <li>From the back, nobody can see what that gift card was for, or what was in the box that just got opened.</li>
          <li>Was that one stolen twice or three times? Cue the argument.</li>
          <li>By the end, half the room has drifted off to the snacks.</li>
        </ul>
      </section>

      <section aria-label="How it helps">
        <h2 className="landing-section-title">How Elephant Exchange helps</h2>
        <div className="landing-points">
          <section className="card">
            <h3>⚡ Turns take seconds</h3>
            <p>
              Every opened gift is on the TV with its holder and how many steals it has left. People decide from their
              seats, and the next name is already on deck.
            </p>
          </section>
          <section className="card">
            <h3>📸 The whole room stays in it</h3>
            <p>
              Guests post photos and comments from their phones into the party's own feed, star the gifts they're after,
              and vote for the Worst Gift at the end.
            </p>
          </section>
          <section className="card">
            <h3>⚖️ The rules keep themselves</h3>
            <p>
              Steal limits, frozen gifts, no take-backs and a final round for the first few players, all kept for you. No
              more debates.
            </p>
          </section>
          <section className="card">
            <h3>📱 Nothing to install</h3>
            <p>
              It runs in the browser. Guests scan the QR code on the TV; you run it from a laptop or your phone. Free.
            </p>
          </section>
        </div>
      </section>

      <section className="card" aria-label="How it works">
        <h2>How it works</h2>
        <ol className="landing-steps">
          <li>
            <strong>Create a Game</strong> and paste in your guest list, or let guests sign themselves up on their phones.
          </li>
          <li>
            <strong>Put the scoreboard on the TV.</strong> Guests scan its QR code to follow along and post.
          </li>
          <li>
            <strong>Call names, open gifts and make steals</strong> from your console. The room sees it all, live.
          </li>
        </ol>
        <p className="muted">
          Made for office holiday parties, family reunions, troops and clubs: 20, 50 or more people.{" "}
          <Link to="/playbook">Read the Host's Playbook</Link> for running a smooth one.
        </p>
      </section>

      <section className="card landing-again" aria-label="Try it">
        <h2>See it in two minutes</h2>
        <p>The demo sets up a whole party with made-up guests, ready to start. Open gifts, steal, and watch the TV keep up.</p>
        {ways}
      </section>

      <div className="landing-ways">
        {signedIn ? null : (
          <div id="host">
            <SignInForm heading="Host a Game" />
          </div>
        )}
        <div id="join">
          <OpenGame />
        </div>
      </div>

      <TipJar />
      <p className="muted hint landing-privacy">
        We count how the app is used (how many Games, how long they run) to keep it working well. We never sell or share
        anything about you.
      </p>
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
