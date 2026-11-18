import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router";
import { isReturnPath, type MyGame, type MyOrg, type RosterMode, type Session } from "./api.js";
import { useApi } from "./ApiContext.js";
import { AdminPage } from "./Admin.js";
import { DemoGame, DemoPage } from "./Demo.js";
import { GamePage } from "./GamePage.js";
import { GameSettings } from "./GameSettings.js";
import { ConfirmDelete } from "./ConfirmDelete.js";
import { StatsPage } from "./Stats.js";
import { FeedbackPage, SuggestBox } from "./Feedback.js";
import { Landing, Playbook, TipJar, TipNoteDialog } from "./Landing.js";
import { MyOrgs, OrgPage } from "./Orgs.js";
import { SignInForm } from "./SignIn.js";
import { WatchScreen } from "./WatchScreen.js";

export function AppRoutes() {
  const api = useApi();
  const { search } = useLocation();
  // Where this visitor came from (?ref=linkedin on a shared link): noted on arrival, not on every page after.
  const arrivedWith = useRef(search);
  useEffect(() => {
    api.noteArrival(arrivedWith.current);
  }, [api]);
  return (
    <main className="page">
      <h1 className="brand">
        <Link to="/">Elephant Exchange</Link>
      </h1>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sign-in" element={<RedeemLink />} />
        <Route path="/playbook" element={<Playbook />} />
        <Route path="/about" element={<About />} />
        <Route path="/try" element={<TryDemo />} />
        <Route path="/games/:id" element={<GamePage />} />
        <Route path="/games/:id/screen" element={<WatchScreen />} />
        <Route path="/games/:id/demo" element={<DemoPage />} />
        <Route path="/games/:id/settings" element={<GameSettings />} />
        <Route path="/orgs/:orgId" element={<OrgPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/stats" element={<StatsPage />} />
        <Route path="/admin/feedback" element={<FeedbackPage />} />
      </Routes>
    </main>
  );
}

/** The front page for anyone, signed in or not (a signed-out visitor also gets it at /). */
function About() {
  const api = useApi();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let current = true;
    api.session().then((s) => current && setSignedIn(Boolean(s)));
    return () => {
      current = false;
    };
  }, [api]);
  if (signedIn === null) return <p className="muted">Loading…</p>;
  return <Landing signedIn={signedIn} />;
}

/**
 * "Try the demo", from the front page: a demo Game belongs to someone, so a visitor signs in first and comes back
 * here, where the demo's one question (how many players) is waiting.
 */
function TryDemo() {
  const api = useApi();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let current = true;
    api.session().then((s) => current && setSignedIn(Boolean(s)));
    return () => {
      current = false;
    };
  }, [api]);
  if (signedIn === null) return <p className="muted">Loading…</p>;
  if (signedIn) {
    return (
      <div className="stack">
        <DemoGame startOpen />
      </div>
    );
  }
  return (
    <div className="stack">
      <section className="card">
        <h2>Try the demo</h2>
        <p className="muted">
          The demo is a practice party of your own, with made-up guests. Sign in with your email first: we'll send a
          link, and the demo opens as soon as you follow it. No password, nothing to install.
        </p>
      </section>
      <SignInForm heading="Sign in to try the demo" next="/try" />
    </div>
  );
}

function Home() {
  const api = useApi();
  const [session, setSession] = useState<Session | null | "loading">("loading");

  useEffect(() => {
    let current = true;
    api.session().then((s) => current && setSession(s ?? null));
    return () => {
      current = false;
    };
  }, [api]);

  if (session === "loading") return <p className="muted">Loading…</p>;
  if (!session) return <Landing />;

  async function signOut() {
    await api.signOut();
    setSession(null);
  }

  return (
    <div className="stack">
      <NewGame tipNoteRead={session.tipNoteRead} onTipNoteRead={() => setSession({ ...session, tipNoteRead: true })} />
      <DemoGame />
      <MyGames />
      <MyOrgs />
      <TipJar />
      <SuggestBox />
      <section className="card">
        <p>Signed in as {session.email}</p>
        <label className="check">
          <input
            type="checkbox"
            checked={session.feedbackOk}
            onChange={(e) => {
              const ok = e.target.checked;
              setSession({ ...session, feedbackOk: ok });
              void api.setFeedbackOk(ok);
            }}
          />
          OK to contact me to ask how it went
        </label>
        <Link to="/playbook">📖 Host's Playbook</Link>
        <Link to="/about">About Elephant Exchange</Link>
        {session.admin && <Link to="/admin">Admin</Link>}
        <button className="secondary" onClick={signOut}>
          Sign out
        </button>
      </section>
    </div>
  );
}

const phaseWords = { setup: "Not started", playing: "In progress", finalRound: "In progress", ended: "Finished" } as const;

/** The Games this person runs, as Host or Co-host, newest first. */
function MyGames() {
  const api = useApi();
  const [mine, setMine] = useState<MyGame[] | "loading" | "failed">("loading");
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api.myGames().then(
      (games) => current && setMine(games),
      () => current && setMine("failed"),
    );
    return () => {
      current = false;
    };
  }, [api]);

  return (
    <section className="card">
      <h2>Your Games</h2>
      {mine === "loading" ? (
        <p className="muted">Loading…</p>
      ) : mine === "failed" ? (
        <p className="error">Your Games couldn't be loaded. Please reload the page.</p>
      ) : mine.length === 0 ? (
        <p className="muted">You haven't run any Games yet.</p>
      ) : (
        <ul className="my-games" aria-label="Your Games">
          {mine.map((g) => (
            <li key={g.id} aria-label={g.name}>
              <span className="row-with-delete">
                <Link to={`/games/${g.id}`}>{g.name}</Link>
                {/* Only the Host's: a Co-host helps run someone else's Game. */}
                {g.role === "host" && deleting !== g.id && (
                  <button className="link danger" aria-label={`Delete ${g.name}`} onClick={() => setDeleting(g.id)}>
                    Delete
                  </button>
                )}
              </span>
              <span className="muted">
                {phaseWords[g.phase]} · {g.players} {g.players === 1 ? "player" : "players"}
                {g.role === "cohost" && " · Co-host"}
              </span>
              {deleting === g.id && (g.phase === "playing" || g.phase === "finalRound") && (
                // A party may be under way: end it on purpose first; the delete question follows.
                <ConfirmDelete
                  question={`${g.name} is still in progress. End it first? Everyone keeps the Gift they're holding, and nobody else gets a turn.`}
                  yes="End the Game"
                  no="Keep playing"
                  onNo={() => setDeleting(null)}
                  onYes={async () => {
                    const result = await api.command(g.id, { type: "EndGame" });
                    if (result.ok) setMine((list) => (Array.isArray(list) ? list.map((x) => (x.id === g.id ? { ...x, phase: "ended" } : x)) : list));
                    return result.ok;
                  }}
                />
              )}
              {deleting === g.id && g.phase !== "playing" && g.phase !== "finalRound" && (
                <ConfirmDelete
                  question={`Delete ${g.name}, with its Players, Gifts, Posts, Photos and votes? This can't be undone.`}
                  yes={`Yes, delete ${g.name}`}
                  onNo={() => setDeleting(null)}
                  onYes={async () => {
                    const ok = await api.deleteGame(g.id);
                    if (ok) {
                      setDeleting(null);
                      setMine((list) => (Array.isArray(list) ? list.filter((x) => x.id !== g.id) : list));
                    }
                    return ok;
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Creating a Game: a button first, then its two settings (the usual values filled in). */
/** `tipNoteRead`: whether this Host has read and considered Jim's tip note; until then New Game shows it first. */
function NewGame({ tipNoteRead, onTipNoteRead }: { tipNoteRead: boolean; onTipNoteRead: () => void }) {
  const api = useApi();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [noting, setNoting] = useState(false);
  const [name, setName] = useState("Gift exchange");
  const [rosterMode, setRosterMode] = useState<RosterMode>("host");
  const [slots, setSlots] = useState("1");
  const [steals, setSteals] = useState("3");
  const [turnSeconds, setTurnSeconds] = useState("60");
  const [orgs, setOrgs] = useState<MyOrg[]>([]);
  const [orgId, setOrgId] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let current = true;
    api.myOrgs().then((mine) => current && setOrgs(mine));
    return () => {
      current = false;
    };
  }, [api, open]);

  if (!open)
    return (
      <>
        <button onClick={() => (tipNoteRead ? setOpen(true) : setNoting(true))}>New Game</button>
        {noting && (
          <TipNoteDialog
            onClose={() => setNoting(false)}
            onContinue={(read) => {
              setNoting(false);
              setOpen(true);
              if (read) {
                onTipNoteRead();
                void api.markTipNoteRead();
              }
            }}
          />
        )}
      </>
    );

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const id = await api.createGame(
        { activeSlots: Number(slots), maxSteals: Number(steals) },
        name.trim(),
        rosterMode,
        Number(turnSeconds),
        orgId || undefined,
      );
      navigate(`/games/${id}`);
    } catch {
      setFailed(true);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>New Game</h2>
      <label htmlFor="game-name">Name of the Game</label>
      <input id="game-name" required maxLength={100} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      {orgs.length > 0 && (
        <>
          <label htmlFor="new-game-org">Organization</label>
          <select id="new-game-org" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">None (the app's own look)</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </>
      )}
      <label htmlFor="slots">Players taking a turn at once</label>
      <input id="slots" type="number" inputMode="numeric" min={1} max={10} required value={slots} onChange={(e) => setSlots(e.target.value)} />
      <label htmlFor="steals">Steals before a Gift is Frozen</label>
      <input id="steals" type="number" inputMode="numeric" min={0} max={20} required value={steals} onChange={(e) => setSteals(e.target.value)} />
      <label htmlFor="turn-seconds">Seconds per turn</label>
      <input
        id="turn-seconds"
        type="number"
        inputMode="numeric"
        min={0}
        max={600}
        required
        aria-describedby="turn-seconds-hint"
        value={turnSeconds}
        onChange={(e) => setTurnSeconds(e.target.value)}
      />
      <p id="turn-seconds-hint" className="muted hint">
        A countdown to keep things moving. Nobody is skipped when it runs out. 0 for none.
      </p>
      <fieldset className="choices">
        <legend>Who adds the Players?</legend>
        <label>
          <input type="radio" name="roster-mode" checked={rosterMode === "host"} onChange={() => setRosterMode("host")} />
          I'll enter them
        </label>
        <label>
          <input type="radio" name="roster-mode" checked={rosterMode === "self"} onChange={() => setRosterMode("self")} />
          Players sign up on their phones
        </label>
      </fieldset>
      {failed && (
        <p className="error" role="alert">
          The Game couldn't be created. Please try again.
        </p>
      )}
      <button type="submit">Create game</button>
    </form>
  );
}

/** Where emailed links land: uses the link up once, then goes back where the person started (home if nowhere). */
function RedeemLink() {
  const api = useApi();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [failed, setFailed] = useState(false);
  // A link works only once, so it must be sent only once, even when React runs effects twice in development.
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const token = params.get("token");
    if (!token) {
      setFailed(true);
      return;
    }
    api.redeemLink(token).then(
      (session) => {
        if (!session) return setFailed(true);
        const next = params.get("next");
        navigate(next && isReturnPath(next) ? next : "/", { replace: true });
      },
      () => setFailed(true),
    );
  }, [api, navigate, params]);

  if (!failed) return <p className="muted">Signing you in…</p>;
  return (
    <>
      <p className="error" role="alert">
        This sign-in link has already been used or has expired. Ask for a new one below.
      </p>
      <SignInForm />
    </>
  );
}
