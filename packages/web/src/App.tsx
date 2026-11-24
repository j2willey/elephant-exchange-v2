import { CohostsPage } from "./Cohosts.js";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router";
import { isReturnPath, type MyGame, type Session } from "./api.js";
import { useApi } from "./ApiContext.js";
import { AdminPage } from "./Admin.js";
import { DemoGame, DemoPage } from "./Demo.js";
import { GamePage } from "./GamePage.js";
import { InvitePage } from "./InvitePage.js";
import { GuidedPage } from "./Guided.js";
import { GameSettings } from "./GameSettings.js";
import { ConfirmDelete } from "./ConfirmDelete.js";
import { StatsPage } from "./Stats.js";
import { SystemPage } from "./System.js";
import { SAMPLE_GAME_ID, SamplePhone } from "./SamplePhone.js";
import { ContactForm, ContactPage, FeedbackPage } from "./Feedback.js";
import { Landing, Playbook, TipJar } from "./Landing.js";
import { NewGame } from "./NewGame.js";
import { MyOrgs, OrgPage } from "./Orgs.js";
import { SignInForm, useSignedIn } from "./SignIn.js";
import mark from "./assets/brand-mark.webp";
import medallion from "./assets/medallion.webp";
import { Backdrop } from "./Backdrop.js";
import { HighlightsPage } from "./HighlightsPage.js";
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
          <Link to="/">
            <img className="brand-mark" src={mark} width={128} height={128} alt="" />
            Elephant Exchange
          </Link>
        </h1>
        <SignOutLink />
      </div>
      <NewVersionNotice />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sign-in" element={<RedeemLink />} />
        <Route path="/invite" element={<InvitePage />} />
        <Route path="/login" element={<SignInPage />} />
        <Route path="/guide" element={<Playbook />} />
        {/* Its old name, still on links already shared. */}
        <Route path="/playbook" element={<Playbook />} />
        <Route path="/about" element={<About />} />
        <Route path="/try" element={<TryDemo />} />
        <Route path="/guided/:scriptId" element={<GuidedPage />} />
        <Route path={`/games/${SAMPLE_GAME_ID}`} element={<SamplePhone />} />
        <Route path="/sample" element={<SamplePhone />} />
        <Route path="/games/:id" element={<GamePage />} />
        <Route path="/games/:id/screen" element={<WatchScreen />} />
        <Route path="/games/:id/highlights" element={<HighlightsPage />} />
        <Route path="/games/:id/demo" element={<DemoPage />} />
        <Route path="/games/:id/settings" element={<GameSettings />} />
        <Route path="/games/:id/cohosts" element={<CohostsPage />} />
        <Route path="/orgs/:orgId" element={<OrgPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/stats" element={<StatsPage />} />
        <Route path="/admin/system" element={<SystemPage />} />
        <Route path="/admin/feedback" element={<FeedbackPage />} />
      </Routes>
      <SiteFooter />
    </main>
  );
}

/**
 * After a deploy, a page still running the old app says a new version is ready, with a button to reload. It never
 * reloads a phone or laptop by itself: someone may be halfway through typing a Post or a Gift's name. The TV's
 * screen is different, since nobody types there and nobody is near it to tap: it reloads itself, once per new build
 * (should the reload somehow bring back the old app, it doesn't go round and round).
 */
function NewVersionNotice() {
  const api = useApi();
  const newBuild = useSyncExternalStore(api.onNewBuild, api.newBuild);
  const tv = /^\/games\/[^/]+\/screen$/.test(useLocation().pathname);
  useEffect(() => {
    if (!newBuild || !tv) return;
    const key = "ee-reloaded-for";
    try {
      if (sessionStorage.getItem(key) === newBuild) return;
      sessionStorage.setItem(key, newBuild);
    } catch {
      return; // can't remember having reloaded, so don't risk reloading forever
    }
    api.reloadPage();
  }, [api, newBuild, tv]);

  if (!newBuild || tv) return null;
  return (
    <div className="new-version" role="status">
      <span>A new version of Elephant Exchange is ready.</span>
      <button type="button" onClick={() => api.reloadPage()}>
        Reload
      </button>
    </div>
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

  if (inGame) return null;
  // Signed out: the way back in, from any page (the front page's Host a Game form is the same thing, further down).
  if (!signedIn) {
    return pathname === "/sign-in" || pathname === "/login" ? null : (
      <Link to="/login" className="sign-out">
        Sign in
      </Link>
    );
  }
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
  return (
    <div className="stack">
      <Backdrop />
      {!signedIn && (
        <section className="card">
          <h2>Try the demo</h2>
          <p className="muted">
            A practice party of your own, with made-up guests, ready to start. No sign-up, nothing to install: pick how
            many guests and go.
          </p>
        </section>
      )}
      <DemoGame startOpen />
    </div>
  );
}

/**
 * Which account this is, without printing the address on the page (it would be in every screenshot and screen
 * share of the home screen): shown only when asked for.
 */
function SignedInAs({ email }: { email: string }) {
  const [shown, setShown] = useState(false);
  return (
    <p className="signed-in-as">
      {shown ? <>Signed in as {email}</> : "Signed in"}{" "}
      <button type="button" className="link" onClick={() => setShown(!shown)}>
        {shown ? "Hide my email" : "Show my email"}
      </button>
    </p>
  );
}

/** A way to reach Jim, at the foot of the app's own pages (not a Game's: a guest's phone and the big screen stay uncluttered). */
function SiteFooter() {
  const { pathname } = useLocation();
  if (pathname.startsWith("/games/") || pathname === "/contact") return null;
  return (
    <footer className="site-footer">
      <Link to="/contact">Questions? Contact Jim</Link>
    </footer>
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
  if (session.visitor) {
    // Trying the demo without signing in: their demo Games, another demo, and the way to host a real party.
    return (
      <div className="stack home">
        <Backdrop />
        <section className="card home-welcome" aria-label="Welcome">
          <img className="home-medallion" src={medallion} width={640} height={640} alt="" />
          <div>
            <h2>Happy holidays!</h2>
            <p className="muted">You're trying the demo. To host your own party, sign in with your email: no password, nothing to install.</p>
          </div>
        </section>
        <SignInForm heading="Host your own party" next="/" />
        <DemoGame />
        <MyGames />
        <ContactForm />
      </div>
    );
  }

  // On a laptop, two columns: hosting on the left (New Game, Your Games, Your Organizations), the rest beside them. On a phone,
  // one column in the order of the slots' numbers, as before (styles.css: .home-wide).
  return (
    <div className="stack home home-wide">
      <Backdrop />
      <section className="card home-welcome" aria-label="Welcome">
        <img className="home-medallion" src={medallion} width={640} height={640} alt="" />
        <div>
          <h2>Happy holidays!</h2>
          <p className="muted">Ready to get this year's gift swap going? Start a Game, or take the demo for a spin first.</p>
        </div>
      </section>
      <div className="home-main">
        <div className="home-slot" style={{ order: 1 }}>
          <NewGame
            session={session}
            onTipNoteRead={() => setSession({ ...session, tipNoteRead: true })}
            onOptionsSaved={(myOptions, alwaysMyOptions) => setSession({ ...session, myOptions, alwaysMyOptions })}
          />
        </div>
        <div className="home-slot" style={{ order: 4 }}>
          <MyGames />
        </div>
        <div className="home-slot" style={{ order: 5 }}>
          <MyOrgs />
        </div>
      </div>
      <div className="home-side">
        <section className="card playbook-card" style={{ order: 2 }}>
          <h2>📖 Host's Guide</h2>
          <p>
            How the game works and how to run a smooth party: why several Players can go at once, how to use the turn
            timer, the rules, and what every setting is for. A five-minute read, worth it before your first party.
          </p>
          <Link to="/guide">Read the Host's Guide</Link>
        </section>
        <div className="home-slot" style={{ order: 3 }}>
          <DemoGame />
        </div>
        <div className="home-slot" style={{ order: 6 }}>
          <TipJar />
        </div>
        <div className="home-slot" style={{ order: 7 }}>
          <ContactForm email={session.email} />
        </div>
        <section className="card" style={{ order: 8 }}>
          <SignedInAs email={session.email} />
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
/** Signing back in, from the top bar's Sign in: the same emailed link as hosting a Game. */
function SignInPage() {
  const signedIn = useSignedIn();
  const navigate = useNavigate();
  useEffect(() => {
    if (signedIn === true) navigate("/", { replace: true });
  }, [signedIn, navigate]);
  if (signedIn !== false) return <p className="muted">Loading…</p>;
  return (
    <div className="stack">
      <Backdrop />
      <SignInForm heading="Sign in" next="/" />
      <section className="card">
        <p className="muted">
          New here? Signing in is all it takes to host a Game: no password, nothing to install. Going to a party
          instead? <Link to="/#join">Enter your code</Link>.
        </p>
      </section>
    </div>
  );
}

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
