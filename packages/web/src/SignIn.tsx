import { useState, type FormEvent } from "react";
import { useApi } from "./ApiContext.js";

const linkMessages = {
  tooMany: "Too many sign-in links have been asked for. Please wait a few minutes and try again.",
  invalidEmail: "That doesn't look like an email address.",
  failed: "Something went wrong sending the link. Please try again.",
};

/** Asks for an email address and sends a sign-in link; `next` is the page the link brings them back to. */
export function SignInForm({ next, heading = "Sign in" }: { next?: string; heading?: string }) {
  const api = useApi();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | keyof typeof linkMessages>("idle");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setStatus(await api.requestLink(email, next).catch(() => "failed" as const));
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
      <h2>{heading}</h2>
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
