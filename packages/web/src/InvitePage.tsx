/**
 * Where a personal invitation's link lands (/invite?token=…). It signs its person in once and takes them to the Game
 * as their Player (ADR 0007). Opened again, on another device or forwarded, it signs nobody in: it offers a sign-in
 * link to the address it was sent to, which only its owner can use. A Host's or Co-host's always does that.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useApi } from "./ApiContext.js";

type Opened = "opening" | "expired" | { refused: "used" | "staff"; gameId: string; hint: string };

export function InvitePage() {
  const api = useApi();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [opened, setOpened] = useState<Opened>("opening");
  const [link, setLink] = useState<"idle" | "sending" | "sent" | "tooMany" | "failed">("idle");
  // It signs in only once, so it must be sent only once, even when React runs effects twice in development.
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    if (!token) return setOpened("expired");
    api.openInvitation(token).then(
      (result) => {
        if (result === "expired" || "refused" in result) return setOpened(result);
        navigate(`/games/${encodeURIComponent(result.gameId)}`, { replace: true });
      },
      () => setOpened("expired"),
    );
  }, [api, navigate, token]);

  if (opened === "opening") return <p className="muted">Opening your invitation…</p>;
  if (opened === "expired")
    return (
      <section className="card stack">
        <h2>This invitation has expired</h2>
        <p>The Game may be over, or your Host may have changed the guest list. Ask your Host for the Game's link.</p>
        <Link to="/">Elephant Exchange</Link>
      </section>
    );

  async function sendLink() {
    setLink("sending");
    const result = await api.invitationLink(token).catch(() => "failed" as const);
    if (result === "expired") setOpened("expired");
    else setLink(result);
  }

  return (
    <section className="card stack" aria-live="polite">
      <h2>{opened.refused === "used" ? "This invitation has been opened already" : "Sign in with a link"}</h2>
      <p>
        {opened.refused === "used"
          ? "An invitation signs in just once, so a forwarded one can't sign in anyone else. "
          : "You help run this Game, so you sign in with a link instead of an invitation. "}
        We can email a sign-in link to <strong>{opened.hint}</strong>, the address it was sent to.
      </p>
      {link === "sent" ? (
        <p>
          Sent. Tap the link in that email to come back to the Game. Not there in a minute or two? Check your{" "}
          <strong>spam or junk folder</strong>.
        </p>
      ) : (
        <button type="button" disabled={link === "sending"} onClick={() => void sendLink()}>
          Email me a sign-in link
        </button>
      )}
      {link === "tooMany" && (
        <p className="error" role="alert">
          Too many sign-in links have been asked for. Please wait a few minutes and try again.
        </p>
      )}
      {link === "failed" && (
        <p className="error" role="alert">
          Something went wrong sending the link. Please try again.
        </p>
      )}
      <p className="muted hint">
        Not yours? <Link to={`/games/${encodeURIComponent(opened.gameId)}`}>Watch the Game</Link> or join with your own email.
      </p>
    </section>
  );
}
