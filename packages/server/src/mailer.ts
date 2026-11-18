import type { Mailer } from "./auth.js";

const escapeHtml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/**
 * Sends sign-in links through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
 * `from` must be on a domain verified in Resend. Throws if Resend refuses, so the person can be told.
 */
export function resendMailer({
  apiKey,
  from,
  fetch = globalThis.fetch,
}: {
  apiKey: string;
  from: string;
  fetch?: typeof globalThis.fetch;
}): Mailer {
  return {
    async sendSignInLink(email, url) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          from,
          to: [email],
          subject: "Sign in to Elephant Exchange",
          text: `Open this link to sign in to Elephant Exchange:\n\n${url}\n\nIt works once, for 15 minutes. If you didn't ask for it, you can ignore this email.`,
          html:
            `<p>Tap the button to sign in to Elephant Exchange.</p>` +
            `<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background:#1f5f8b;color:#fff;border-radius:8px;text-decoration:none">Sign in</a></p>` +
            `<p>Or open this link: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>` +
            `<p style="color:#666">It works once, for 15 minutes. If you didn't ask for it, you can ignore this email.</p>`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Resend refused the email: ${res.status} ${await res.text().catch(() => "")}`);
    },

    async sendFeedbackRequest(email, gameName, url) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          from,
          to: [email],
          subject: `How did ${gameName} go?`,
          text:
            `Thanks for hosting ${gameName} with Elephant Exchange. How did it go? It takes 20 seconds:\n\n${url}\n\n` +
            `Jim built the app for his own holiday party, and what Hosts say decides what gets better next.\n\n` +
            `You're getting this once, because you said it was OK to ask. You can untick that on your home screen.`,
          html:
            `<p>Thanks for hosting <strong>${escapeHtml(gameName)}</strong> with Elephant Exchange. How did it go? It takes 20 seconds.</p>` +
            `<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background:#b3202e;color:#fff;border-radius:8px;text-decoration:none">Tell us how it went</a></p>` +
            `<p>Jim built the app for his own holiday party, and what Hosts say decides what gets better next.</p>` +
            `<p style="color:#666">You're getting this once, because you said it was OK to ask. You can untick that on your home screen.</p>`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Resend refused the email: ${res.status} ${await res.text().catch(() => "")}`);
    },
  };
}
