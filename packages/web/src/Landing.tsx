import { RECOMMENDED_OPTIONS, type GameOptions } from "@elephant/rules";
import { OPTION_HELP } from "./GameOptionFields.js";
import { useEffect, useState, type FormEvent } from "react";
import type { Testimonial } from "./api.js";
import { useApi } from "./ApiContext.js";
import { Link, useNavigate } from "react-router";
import party from "./assets/landing-party.webp";
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
      {/* The party itself, softened, behind the whole page: what the app is for, before a word is read. */}
      <div className="landing-backdrop" style={{ backgroundImage: `url(${party})` }} aria-hidden="true" />
      <section className="landing-hero" aria-label="What it is">
        <img
          className="landing-party"
          src={party}
          width={1024}
          height={434}
          alt="A big office holiday party in full swing: a room of round tables, a pile of wrapped gifts half picked over, guests holding up the gifts they opened, and the scoreboard on the TV at the far end"
        />
        <p className="landing-tagline">The White Elephant gift swap that keeps the whole room in the game.</p>
        <p className="landing-lede">
          Run your party's gift exchange from a laptop or a phone. Every opened gift, who has it and how many times it's
          been stolen goes up on the big screen (a TV or projector), and everyone follows along on their own phone, with the party's own photo feed
          to post to, reply in and react to.
        </p>
        {ways}
        <p className="landing-party-link">
          Going to a party? <a href="#join">Enter your code</a>
        </p>
        <figure className="landing-shot">
          <img src={scoreboard} width={1280} height={720} alt="The scoreboard on the party's big screen: who's up now and on deck, every gift with its holder and steals, the latest posts, and a QR code for guests" />
          <figcaption className="muted">The scoreboard on the party's big screen.</figcaption>
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
              Every opened gift is on the big screen with its holder and how many steals it has left. People decide from their
              seats, and the next name is already on deck.
            </p>
          </section>
          <section className="card">
            <h3>📸 A party feed, not just a scoreboard</h3>
            <p>
              Guests post photos and comments from their phones into the party's own feed, reply to each other and react
              with friendly emoji (yes, there's a leg lamp). Photos attach to the gift they show, so anyone can tap a gift
              and see what it is, and who's grinning about it.
            </p>
          </section>
          <section className="card">
            <h3>⭐ The whole room stays in it</h3>
            <p>Guests star the gifts they're after, see who's on deck, and vote for the Worst Gift at the end.</p>
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
              It runs in the browser. Guests scan the QR code on the big screen; you run it from a laptop or your phone. Free.
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
            <strong>Put the scoreboard on the big screen</strong> (a TV or projector). Guests scan its QR code to follow along and post.
          </li>
          <li>
            <strong>Call names, open gifts and make steals</strong> from your console. The room sees it all, live.
          </li>
        </ol>
        <p className="muted">
          Made for big parties of 25 or more: office holiday parties, family reunions, troops and clubs.{" "}
          <Link to="/guide">Read the Host's Guide</Link> for running a smooth one.
        </p>
      </section>

      <Testimonials />

      <section className="card landing-again" aria-label="Try it">
        <h2>See it in two minutes</h2>
        <p>The demo sets up a whole party with made-up guests, ready to start. Open gifts, steal, and watch the big screen keep up.</p>
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
          I've read and considered this <span className="muted">(this note won't show again)</span>
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
      <p className="muted">Scan the QR code on the big screen, or paste the link your Host sent.</p>
      <label htmlFor="game-link">Game link or code</label>
      <input id="game-link" autoComplete="off" autoCapitalize="off" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
      <button type="submit" disabled={!id}>
        Open the Game
      </button>
    </form>
  );
}

/** What Hosts and guests said, in their own words: only those Jim published, with their OK. Hidden until there's one. */
function Testimonials() {
  const api = useApi();
  const [said, setSaid] = useState<Testimonial[]>([]);
  useEffect(() => {
    let current = true;
    api.testimonials().then((t) => current && setSaid(t));
    return () => {
      current = false;
    };
  }, [api]);
  if (said.length === 0) return null;
  return (
    <section aria-label="What people say">
      <h2 className="landing-section-title">What people say</h2>
      <div className="landing-points testimonials">
        {said.slice(0, 6).map((t, i) => (
          <figure key={i} className="card testimonial">
            {t.rating !== null && <p className="testimonial-stars" aria-label={`${t.rating} stars`}>{"★".repeat(t.rating)}</p>}
            <blockquote>“{t.quote}”</blockquote>
            <figcaption className="muted">
              — {t.name ?? (t.kind === "host" ? "A Host" : "A guest")}
              {t.name && <>, {t.kind === "host" ? "Host" : "guest"}</>}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

/** A Game's id from its link (any page of it: the Game, its scoreboard) or from the id on its own. */
function gameIdFrom(text: string): string | null {
  const trimmed = text.trim();
  const fromLink = trimmed.match(/\/games\/([A-Za-z0-9_-]+)/);
  if (fromLink) return fromLink[1]!;
  return /^[A-Za-z0-9_-]{4,64}$/.test(trimmed) ? trimmed : null;
}

const SETTINGS_EXPLAINED: [keyof GameOptions, string][] = [
  ["activeSlots", "Players taking a turn at once"],
  ["maxSteals", "Steals before a Gift is Frozen"],
  ["turnSeconds", "Seconds per turn"],
  ["rosterMode", "Who adds the Players?"],
  ["approveNames", "Approve names"],
  ["moderation", "Feed posting"],
];
const RECOMMENDED_WORDS: Record<keyof GameOptions, string> = {
  activeSlots: String(RECOMMENDED_OPTIONS.activeSlots),
  maxSteals: String(RECOMMENDED_OPTIONS.maxSteals),
  turnSeconds: `${RECOMMENDED_OPTIONS.turnSeconds} seconds`,
  rosterMode: RECOMMENDED_OPTIONS.rosterMode === "host" ? "I'll enter them" : "Players sign up on their phones",
  approveNames: RECOMMENDED_OPTIONS.approveNames ? "on" : "off",
  moderation: { open: "Open", approval: "Approval", paused: "Paused" }[RECOMMENDED_OPTIONS.moderation],
};

/** v1's Host's Guide, brought up to date: how to run a smooth 20+ person exchange with this app. */
export function Playbook() {
  return (
    <article className="stack playbook">
      <Link to="/" className="back">
        ← Home
      </Link>
      <header>
        <h2>Host's Guide</h2>
        <p className="muted">
          How the game works, and how to run a smooth exchange for a big party, 25 people or more. A five-minute read; every setting is
          explained at the end.
        </p>
      </header>

      <section className="card">
        <h3>🐘 How the game works</h3>
        <p>
          Everyone brings one wrapped gift, and the gifts go in a pile. Players are called in a random order. On your turn
          you either <strong>open</strong> a gift from the pile or <strong>steal</strong> one that's already been opened.
        </p>
        <p>
          If your gift is stolen, you go again straight away: open a new gift or steal a different one. That's where the
          fun is: a good gift can change hands several times while the room cheers or groans.
        </p>
        <p>
          Two rules keep it fair and moving. <strong>The Steal limit:</strong> after a set number of Steals (three is
          classic) a Gift is <strong>Frozen</strong>, and whoever holds it keeps it. <strong>No take-backs:</strong> you
          can't steal back the Gift that was just taken from you. When everyone has had a turn and holds one Gift, the
          game is over.
        </p>
        <p>
          The app keeps track of all of it: whose turn it is, who holds what, how many Steals each Gift has had. You call
          the names and enjoy the party.
        </p>
      </section>

      <section className="card">
        <h3>📋 Before the party</h3>
        <p>
          Start a Game and name it after your party. Use the recommended settings, or customize them: each one has an ⓘ
          that explains it, and they're all explained at the end of this page too. Tick{" "}
          <strong>Always start with these settings</strong> and your next Game starts with them in one tap. Nothing is
          fixed: you can change any setting later in the Game's Settings, even mid-party.
        </p>
        <p>
          Then get the names in. Paste the guest list straight from an email or a spreadsheet, one name per line; or let
          guests add themselves from their phones while they eat appetizers, by turning on sign-up in Settings and sending
          them the link.
        </p>
        <p>
          <strong>Recruit a Co-host or two.</strong> In a big group, a Co-host at your side can type in what each Gift is
          while you call the next name, and keep an eye on the Feed. Open 🛡 Co-hosts from your console, find them by name
          and switch them on. A Co-host can do everything you can at the party, from their own phone or laptop.
        </p>
        <p>
          <strong>Dress it up.</strong> In the Game's Settings, pick one of the <strong>Ready-made looks</strong>, from a
          cozy fireside to retro '80s neon: one tap sets the background on every phone and the big screen, and colors to
          match. Or use your own logo, background photo and colors. Run parties for the same office or club every year?
          Create an Organization from your home screen, give it its look once, and every Game you run for it wears it.
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
          <strong>Tip: fit it to the screen.</strong> On the computer driving the TV, press <kbd>F11</kbd> for full
          screen (<kbd>Ctrl</kbd> <kbd>⌘</kbd> <kbd>F</kbd> on a Mac). If the words are too small to read from the back,
          or too big to fit, zoom: <kbd>Ctrl</kbd> and <kbd>+</kbd> makes everything bigger, <kbd>Ctrl</kbd> and{" "}
          <kbd>−</kbd> smaller, and <kbd>Ctrl</kbd> and <kbd>0</kbd> puts it back (<kbd>⌘</kbd> instead of{" "}
          <kbd>Ctrl</kbd> on a Mac).
        </div>
        <div className="tip">
          <strong>Tip:</strong> when someone opens something small or detailed, a gift card or a book, ask them to post a
          Photo from their phone. It's on the big screen in seconds, and nobody at the back has to ask "what is that?"
        </div>
      </section>

      <section className="card">
        <h3>⏱ Keeping it moving</h3>
        <p>
          The classic game calls one Player at a time, and the whole room watches every Pick. That's perfect for a dozen
          people. With 30, it can take two hours, and the people waiting near the end lose interest.
        </p>
        <p>
          <strong>Several Players at once.</strong> Set "Players taking a turn at once" to 2 or 3. While one Player is
          unwrapping and the room is reacting, the next one is already choosing. Everyone still gets exactly one turn;
          there's just less waiting between them. The scoreboard shows everyone who's up, and who's On Deck next.
        </p>
        <p>
          <strong>The turn timer.</strong> In the middle turns, with lots of Gifts open, Players can stall while they
          decide what to steal. The timer counts down on the scoreboard (a minute by default), turns amber, then red. It's
          a friendly nudge, not a rule: nobody loses their turn when it runs out, and the Player keeps choosing until you
          move on. If you stop to explain the rules to someone, restart their timer. Set it to 0 if your crowd doesn't
          need it.
        </p>
      </section>

      <section className="card">
        <h3>🎁 Running the Game</h3>
        <p>
          Players are drawn at random, and the next one is shown On Deck so they can get ready. For each Player who's up,
          open a Gift (type what's inside; you can add details or fix a typo later) or make a Steal. Moving fast? Tap{" "}
          <strong>Name it later</strong>: the open is recorded at once as "Ann's gift", and you or a Co-host fill in what it
          is a moment later. If someone stepped
          out, Skip them and they'll be called again later. Tapped the wrong thing? Undo takes back the last Pick.
        </p>
        <p>
          <strong>🎤 The pitch.</strong> The holder of a Gift can pitch it from their phone, like an ad: a bold tagline,
          a creative story to tempt someone into stealing a horrible gift (or every reason nobody should take one they
          love), and a photo. When it's stolen, the new holder adds their own part, so the story builds through the
          night. The holder can tap <strong>Pitch it again</strong> to send their ad back to the top of the Feed, every 5
          minutes at most so nobody bombards it. You or a Co-host can pitch for a guest without a phone. Read the best
          ones aloud; the big screen's catalog shows the newest part of each.
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
          <strong>The Final Round.</strong> Once everyone holds a Gift, the first few Players called get one last chance
          to steal, since they had little to steal from when they went. You choose how many.
        </p>
      </section>

      <section className="card">
        <h3>📸 The party Feed</h3>
        <p>
          The Feed is the party's own social stream, on every phone and the big screen. Guests post a few words, a Photo or both,
          reply to each other's posts and react with friendly emoji: 👍 ❤️ 😂 🎉 🔥 😮, a ⛄ snowman and, of course, the leg
          lamp. Only friendly ones, to keep it in good spirits.
        </p>
        <p>
          <strong>Photos of the Gifts.</strong> A post can say which Gift it's about, and every Gift has its own{" "}
          <strong>📷 Add a photo</strong> button. Each Gift then shows its newest Photo, and a tap opens all of them: the
          Gift itself, the grin of the Player who opened it, or the frown that says "please steal this". Forgot to pick
          the Gift? The poster, you or a Co-host can attach it afterwards.
        </p>
        <p>
          <strong>Get the Feed going.</strong> When you open the Game, tell the room:{" "}
          <em>"Post a photo from your phone, and it goes up on the big screen."</em> Then post the first one yourself, a selfie
          with the Gift pile works. Once people see their own photo on the big screen, the rest follow. Guests browsing
          the Gifts see a little bubble on the 💬 Feed tab counting the new Posts, so nobody misses the fun.
        </p>
        <p>
          <strong>Sharing the fun.</strong> Anyone can tap <strong>Share</strong> on a Post to send it, Photo and all, to
          their own messages or social media. The link in it goes to Elephant Exchange's front page, never to your
          party, so sharing a funny moment doesn't let strangers follow along.
        </p>
        <p>
          <strong>You stay in charge.</strong> You and your Co-hosts have simple tools to keep the Feed, and the names
          people choose, right for your crowd, whether it's the office party or a room full of teenagers:
        </p>
        <ul>
          <li>
            <strong>Hide</strong> any Post (or a Post with all its replies), and <strong>Mute</strong> someone so they can
            no longer post.
          </li>
          <li>
            <strong>Rename</strong> anyone and lock the name, so they can't change it back. Guests can change their own
            name until you lock it.
          </li>
          <li>
            Nobody can flood the Feed: a guest can make 3 Posts a minute, and pitch a Gift again every 5 minutes. You can
            change both in Settings.
          </li>
          <li>
            For a tough crowd, choose <strong>Approve names</strong>, or have each Post wait for your approval, or pause
            posting altogether. You can switch any of these at any time in Settings.
          </li>
        </ul>
        <p>After the party, download every Photo as a keepsake album. Photos are deleted 60 days after the Game.</p>
      </section>

      <section className="card">
        <h3>🗳️ The Worst Gift Vote</h3>
        <p>
          Every exchange has that one Gift: the singing fish, the creepy doll, the fruitcake. Instead of leaving its
          holder feeling stuck, make it a contest. After you end the Game, open the vote, and everyone votes from their
          phone for the worst Gift. Show the counts live on the big screen, hide them until the reveal, or let every Gift parade
          past as a reminder.
        </p>
        <p>When you close the vote, the big screen reveals the winner, the top five and a Photo of the winning Gift.</p>
        <p>
          Then switch the big screen to <strong>✨ Highlights</strong>: a slideshow of the night, made up as it goes from
          the Photos, the Posts that got the most laughs, the Pitch taglines and the most-stolen Gift. It keeps going
          as long as the party does.
        </p>
        <p>
          The highlights stay on everyone's phone too: <strong>✨ The night's highlights</strong> opens a page to scroll
          through, play as a slideshow, and share with a link, for the people who couldn't make it.
        </p>
        <div className="tip">
          <strong>Tip: the consolation prize.</strong> Keep one or two small, genuinely good gifts hidden, like chocolate
          or a gift card. The Worst Gift's holder picks a prize, so a loss becomes a win and the night ends on a laugh.
        </div>
      </section>

      <section className="card" aria-label="Every setting explained">
        <h3>⚙️ Every setting explained</h3>
        <p className="muted">The recommended value comes first. You can change any of them later in the Game's Settings.</p>
        <dl className="settings-explained">
          {SETTINGS_EXPLAINED.map(([key, label]) => (
            <div key={key}>
              <dt>
                {label} <span className="muted">(recommended: {RECOMMENDED_WORDS[key]})</span>
              </dt>
              <dd>{OPTION_HELP[key]}</dd>
            </div>
          ))}
        </dl>
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
