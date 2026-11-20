import { CohostsPage } from "./Cohosts.js";
import { useEffect, useRef, useState } from "react";
import { Link, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router";
import { isReturnPath, type MyGame, type Session } from "./api.js";
import { useApi } from "./ApiContext.js";
import { AdminPage } from "./Admin.js";
import { DemoGame, DemoPage } from "./Demo.js";
import { GamePage } from "./GamePage.js";
import { GameSettings } from "./GameSettings.js";
import { ConfirmDelete } from "./ConfirmDelete.js";
import { StatsPage } from "./Stats.js";
import { SAMPLE_GAME_ID, SamplePhone } from "./SamplePhone.js";
import { FeedbackPage, SuggestBox } from "./Feedback.js";
import { Landing, Playbook, TipJar } from "./Landing.js";
import { NewGame } from "./NewGame.js";
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
      <div className="top-bar">
        <h1 className="brand">
          <Link to="/">Elephant Exchange</Link>
        </h1>
        <SignOutLink />
      </div>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sign-in" element={<RedeemLink />} />
        <Route path="/guide" element={<Playbook />} />
        {/* Its old name, still on links already shared. */}
        <Route path="/playbook" element={<Playbook />} />
        <Route path="/about" element={<About />} />
        <Route path="/try" element={<TryDemo />} />
        <Route path={`/games/${SAMPLE_GAME_ID}`} element={<SamplePhone />} />
        <Route path="/sample" element={<SamplePhone />} />
        <Route path="/games/:id" element={<GamePage />} />
        <Route path="/games/:id/screen" element={<WatchScreen />} />
        <Route path="/games/:id/demo" element={<DemoPage />} />
        <Route path="/games/:id/settings" element={<GameSettings />} />
        <Route path="/games/:id/cohosts" element={<CohostsPage />} />
        <Route path="/orgs/:orgId" element={<OrgPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/stats" element={<StatsPage />} />
        <Route path="/admin/feedback" element={<FeedbackPage />} />
      </Routes>
    </main>
  );
}

/**
 * Sign out, at the top of every page for someone signed in, except inside a Game: there a guest could tap it by
 * mistake mid-party, and the TV's scoreboard has no business signing out. (The home screen has its own button too.)
 */
function SignOutLink() {
  const api = useApi();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [signedIn, setSignedIn] = useState(false);
  const inGame = pathname.startsWith("/games/");

  useEffect(() => {
    if (inGame) return;
    let current = true;
    api.session().then((s) => current && setSignedIn(Boolean(s)), () => {});
    return () => {
      current = false;
    };
  }, [api, pathname, inGame]);

  if (inGame || !signedIn) return null;
  return (
    <button
      className="link sign-out"
      onClick={() =>
        void api.signOut().then(() => {
          setSignedIn(false);
          navigate("/"); // the home screen checks again who's signed in, so it shows the front page
        })
      }
    >
      Sign out
    </button>
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
  // Checked again on every visit, such as straight after signing out from the top of the page.
  const { key: visit } = useLocation();

  useEffect(() => {
    let current = true;
    api.session().then((s) => current && setSession(s ?? null));
    return () => {
      current = false;
    };
  }, [api, visit]);

  if (session === "loading") return <p className="muted">Loading…</p>;
  if (!session) return <Landing />;

  return (
    <div className="stack">
      <NewGame
        session={session}
        onTipNoteRead={() => setSession({ ...session, tipNoteRead: true })}
        onOptionsSaved={(myOptions, alwaysMyOptions) => setSession({ ...session, myOptions, alwaysMyOptions })}
      />
      <section className="card playbook-card">
        <h2>📖 Host's Guide</h2>
        <p>
          How the game works and how to run a smooth party: why several Players can go at once, how to use the turn timer,
          the rules, and what every setting is for. A five-minute read, worth it before your first party.
        </p>
        <Link to="/guide">Read the Host's Guide</Link>
      </section>
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
        <Link to="/about">About Elephant Exchange</Link>
        {session.admin && <Link to="/admin">Admin</Link>}
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
