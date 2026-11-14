import { useEffect, useRef, useState, type FormEvent } from "react";
import { Route, Routes, useNavigate, useSearchParams } from "react-router";
import { useApi } from "./ApiContext.js";

export function AppRoutes() {
  return (
    <main className="page">
      <h1 className="brand">Elephant Exchange</h1>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sign-in" element={<RedeemLink />} />
      </Routes>
    </main>
  );
}

function Home() {
  const api = useApi();
  const [session, setSession] = useState<{ email: string } | null | "loading">("loading");

  useEffect(() => {
    let current = true;
    api.session().then((s) => current && setSession(s ?? null));
    return () => {
      current = false;
    };
  }, [api]);

  if (session === "loading") return <p className="muted">Loading…</p>;
  if (!session) return <SignInForm />;

  async function signOut() {
    await api.signOut();
    setSession(null);
  }

  return (
    <section className="card">
      <p>Signed in as {session.email}</p>
      <button className="secondary" onClick={signOut}>
        Sign out
      </button>
    </section>
  );
}

const linkMessages = {
  tooMany: "Too many sign-in links have been asked for. Please wait a few minutes and try again.",
  invalidEmail: "That doesn't look like an email address.",
  failed: "Something went wrong sending the link. Please try again.",
};

function SignInForm() {
  const api = useApi();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | keyof typeof linkMessages>("idle");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setStatus(await api.requestLink(email).catch(() => "failed" as const));
  }

  if (status === "sent") {
    return (
      <section className="card" aria-live="polite">
        <h2>Check your email</h2>
        <p>
          We sent a sign-in link to <strong>{email.trim()}</strong>. It works once, for 15 minutes.
        </p>
      </section>
    );
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Sign in</h2>
      <label htmlFor="email">Email address</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      {status in linkMessages && (
        <p className="error" role="alert">
          {linkMessages[status as keyof typeof linkMessages]}
        </p>
      )}
      <button type="submit" disabled={status === "sending"}>
        Send me a sign-in link
      </button>
    </form>
  );
}

/** Where emailed links land: uses the link up once, then goes home signed in. */
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
      (session) => (session ? navigate("/", { replace: true }) : setFailed(true)),
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
