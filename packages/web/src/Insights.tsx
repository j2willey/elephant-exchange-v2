import type { StatsInsights } from "./api.js";

const STEPS = { signedIn: "Signed in", created: "Created a Game", started: "Started one", finished: "Finished one", voted: "Ran the vote" } as const;
const FEATURES: Record<string, string> = {
  posts: "Posts",
  photos: "Photos",
  orgTheme: "Organization look",
  ownLook: "Game's own look",
  cohosts: "Co-hosts",
  selfSignup: "Self sign-up",
  rosterPaste: "Roster paste",
  screenModes: "Scoreboard modes",
};
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const pct = (n: number | null) => (n === null ? "—" : `${n}%`);
const num = (n: number | null) => (n === null ? "—" : String(n));

/** Horizontal bars with their values beside them: for a few labelled amounts, such as the funnel. */
function BarList({ label, items, max }: { label: string; items: { name: string; value: number; note?: string }[]; max: number }) {
  return (
    <ul className="bar-list" aria-label={label}>
      {items.map((i) => (
        <li key={i.name} aria-label={`${i.name}: ${i.value}${i.note ? `, ${i.note}` : ""}`} title={`${i.name}: ${i.value}${i.note ? ` (${i.note})` : ""}`}>
          <span className="bar-name">{i.name}</span>
          <span className="bar-track">
            {i.value > 0 && <span className="bar" style={{ width: `${max ? (i.value / max) * 100 : 0}%` }} />}
          </span>
          <span className="bar-value">
            {i.value}
            {i.note && <span className="muted"> · {i.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Columns over time or the clock; each says its amount on hover (and to a screen reader). */
function Columns({ label, items, unit }: { label: string; items: { name: string; value: number }[]; unit: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <figure className="columns-chart">
      <ul aria-label={label} style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((i) => (
          <li key={i.name} aria-label={`${i.name}: ${i.value} ${unit}`} title={`${i.name}: ${i.value} ${unit}`}>
            <span className="column" style={{ height: `${(i.value / max) * 100}%` }} />
          </li>
        ))}
      </ul>
      <div className="column-labels" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((i, n) => (
          <span key={i.name}>{items.length > 7 && n % 3 !== 0 ? "" : i.name}</span>
        ))}
      </div>
      <figcaption className="muted">Most: {Math.max(0, ...items.map((i) => i.value))} {unit}</figcaption>
    </figure>
  );
}

/** Monday of the week `at` falls in, in the viewer's own time zone. */
function weekOf(at: Date): Date {
  const d = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/**
 * Phase 2 of the statistics (docs/stats-plan.md): where Hosts drop off, how big and lively the parties are, how
 * the Game plays, which features get used, and when Games happen. Over played Games unless it says otherwise.
 */
export function Insights({ insights, now = new Date() }: { insights: StatsInsights; now?: Date }) {
  const { funnel, engagement, gameplay, features, returningHosts, startTimes, costs } = insights;
  const starts = startTimes.map((t) => new Date(t));
  const played = starts.length;

  // The last 12 weeks, oldest first.
  const thisWeek = weekOf(now);
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const start = new Date(thisWeek);
    start.setDate(start.getDate() - (11 - i) * 7);
    return start;
  });
  const perWeek = weeks.map((w) => ({
    name: w.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    value: starts.filter((s) => weekOf(s).getTime() === w.getTime()).length,
  }));
  const perWeekday = WEEKDAYS.map((name, i) => ({ name, value: starts.filter((s) => (s.getDay() + 6) % 7 === i).length }));
  const perHour = Array.from({ length: 24 }, (_, h) => ({
    name: h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`,
    value: starts.filter((s) => s.getHours() === h).length,
  }));
  const today = now.toISOString().slice(0, 10);
  const emailsToday = costs.signInEmails.find((d) => d.day === today)?.count ?? 0;
  const busiestEmailDay = Math.max(0, ...costs.signInEmails.map((d) => d.count));

  return (
    <>
      <section className="card">
        <h2>Where Hosts drop off</h2>
        <p className="muted hint">People who reached each step. After signing in, only Hosts of real Games count.</p>
        <BarList
          label="Funnel"
          max={funnel[0]?.people ?? 0}
          items={funnel.map((f) => ({
            name: STEPS[f.step],
            value: f.people,
            ...(f.step !== "signedIn" && funnel[0]?.people ? { note: `${Math.round((f.people / funnel[0].people) * 100)}%` } : {}),
          }))}
        />
      </section>

      <section className="card">
        <h2>Played Games per week</h2>
        <Columns label="Played Games per week" items={perWeek} unit="Games" />
      </section>

      <section className="card">
        <h2>When Games start</h2>
        <p className="muted hint">By the first Pick, in your time zone.</p>
        <div className="two-charts">
          <Columns label="Games by day of the week" items={perWeekday} unit="Games" />
          <Columns label="Games by hour" items={perHour} unit="Games" />
        </div>
      </section>

      <section className="card" aria-label="Parties and play">
        <h2>Parties and play</h2>
        <dl className="stat-tiles">
          {(
            [
              ["Players per Game", num(engagement.averagePlayers)],
              ["On their own phones", pct(engagement.signedInShare)],
              ["Screens watching at once", num(engagement.averagePeakScreens)],
              ["Steals per Game", num(gameplay.averageSteals)],
              ["Frozen Gifts per Game", num(gameplay.averageFrozenGifts)],
              ["Seconds per Pick", num(gameplay.averageSecondsPerPick)],
              ["Used the Final Round", pct(gameplay.finalRoundShare)],
              ["Ran the vote", pct(gameplay.voteShare)],
              ["Undos per Game", num(gameplay.undosPerGame)],
              ["Skips per Game", num(gameplay.skipsPerGame)],
              ["Returning Hosts", `${returningHosts.returning} of ${returningHosts.hosts}`],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="muted hint">Many undos or skips can point at a confusing screen.</p>
      </section>

      <section className="card">
        <h2>Features used</h2>
        <p className="muted hint">How many of the {played} played Games used each.</p>
        <BarList
          label="Features used"
          max={played}
          items={[...features]
            .sort((a, b) => b.games - a.games)
            .map((f) => ({ name: FEATURES[f.feature] ?? f.feature, value: f.games, ...(played ? { note: `${Math.round((f.games / played) * 100)}%` } : {}) }))}
        />
      </section>

      <GameSetup setup={insights.setup} played={played} />

      <section className="card" aria-label="Running costs">
        <h2>Running costs</h2>
        <dl className="stat-tiles">
          <div>
            <dt>Sign-in emails today</dt>
            <dd>
              {emailsToday} <span className="muted small">of {costs.signInEmailCap}</span>
            </dd>
          </div>
          <div>
            <dt>Busiest day, last 14</dt>
            <dd>
              {busiestEmailDay} <span className="muted small">of {costs.signInEmailCap}</span>
            </dd>
          </div>
          <div>
            <dt>Photos stored</dt>
            <dd>{(costs.photoBytes / 1_000_000).toFixed(1)} MB</dd>
          </div>
        </dl>
        {busiestEmailDay >= costs.signInEmailCap * 0.8 && (
          <p className="error" role="alert">
            Sign-in emails came close to the daily cap. Time for the paid Resend plan (docs/scale-plan.md).
          </p>
        )}
      </section>
    </>
  );
}

const CHOICES = { recommended: "Recommended settings", customized: "Customized", saved: "Their saved settings", unknown: "Before this was asked" } as const;
const OPTIONS: Record<string, string> = {
  activeSlots: "Players at once",
  maxSteals: "Steals before Frozen",
  turnSeconds: "Seconds per turn",
  rosterMode: "Who adds Players",
  approveNames: "Approve names",
  moderation: "Feed posting",
};
const VALUES: Record<string, string> = { host: "Host enters", self: "Sign up on phones", true: "on", false: "off" };
const valueWords = (v: string) => VALUES[v] ?? v;
const tally = (values: { value: string; games: number }[], recommended: string) =>
  values.length === 0
    ? "—"
    : values.map((v) => `${valueWords(v.value)}${v.value === recommended ? " (rec.)" : ""}: ${v.games}`).join(" · ");

/** How Hosts set their Games up: which options might deserve to become the recommended ones. */
function GameSetup({ setup, played }: { setup: StatsInsights["setup"]; played: number }) {
  const created = setup.choices.reduce((n, c) => n + c.games, 0);
  return (
    <section className="card" aria-label="How Games are set up">
      <h2>How Games are set up</h2>
      <p className="muted hint">How the {created} Games created (played or not) got their settings, and how many of those Hosts opened the full list first.</p>
      <BarList
        label="Settings chosen"
        max={created}
        items={setup.choices
          .filter((c) => c.choice !== "unknown" || c.games > 0)
          .map((c) => ({ name: CHOICES[c.choice], value: c.games, note: `${c.looked} looked at the list` }))}
      />

      <h3>Each setting</h3>
      <p className="muted hint">
        What Games were created with (all Games), what the {played} played Games ended up with, and how many played Games
        changed it after creating the Game: a sign the starting value didn't suit.
      </p>
      <div className="table-scroll">
        <table aria-label="Settings used">
          <thead>
            <tr>
              <th>Setting</th>
              <th>Recommended</th>
              <th>Created with</th>
              <th>Played with</th>
              <th>Changed later</th>
            </tr>
          </thead>
          <tbody>
            {setup.options.map((o) => (
              <tr key={o.option}>
                <td>{OPTIONS[o.option] ?? o.option}</td>
                <td>{valueWords(o.recommended)}</td>
                <td>{tally(o.atStart, o.recommended)}</td>
                <td>{tally(o.atEnd, o.recommended)}</td>
                <td>{o.changedLater}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>The turn timer against real Turns</h3>
      <p className="muted hint">
        Played Games by their timer: how long a Turn really took (from being called up to the Pick, breaks left out), and
        how often it ran past the timer.
      </p>
      {setup.timer.length === 0 ? (
        <p className="muted">No played Games yet.</p>
      ) : (
        <div className="table-scroll">
          <table aria-label="Turn timer">
            <thead>
              <tr>
                <th>Timer</th>
                <th>Games</th>
                <th>Turns</th>
                <th>Average Turn</th>
                <th>Past the timer</th>
              </tr>
            </thead>
            <tbody>
              {setup.timer.map((t) => (
                <tr key={t.seconds}>
                  <td>{t.seconds === 0 ? "None" : `${t.seconds} s`}</td>
                  <td>{t.games}</td>
                  <td>{t.turns}</td>
                  <td>{t.averageTurnSeconds === null ? "—" : `${t.averageTurnSeconds} s`}</td>
                  <td>{pct(t.overTimerShare)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
