import type { Invitation, Mailer } from "./auth.js";

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

    async sendInvitation(email, invitation) {
      const { subject, text, html } = invitationEmail(invitation);
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [email], subject, text, html }),
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

    async sendContactMessage(to, message, replyTo, sender) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          from,
          to,
          ...(replyTo ? { reply_to: replyTo } : {}),
          subject: `Elephant Exchange: a message from ${sender}`,
          text: `${message}\n\n— ${sender}${replyTo ? `, ${replyTo} (just reply to this email)` : " (no reply address given)"}`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Resend refused the email: ${res.status} ${await res.text().catch(() => "")}`);
    },
  };
}

/**
 * A personal invitation's words. The app adds to the party's own swap, and phones are optional (CLAUDE.md), so it
 * says what the link is for without suggesting anyone needs it to play.
 */
export function invitationEmail({ gameName, tagline, whenWhere, name, url }: Invitation): { subject: string; text: string; html: string } {
  const about = [tagline, whenWhere].filter(Boolean);
  const keep = "It's just for you: it signs you in as " + name + ", so please don't forward it.";
  return {
    subject: `You're invited: ${gameName}`,
    text:
      `Hi ${name},\n\nYou're on the list for ${gameName}.\n${about.map((l) => `${l}\n`).join("")}\n` +
      `Bring a wrapped gift for the White Elephant swap. On the day, you can follow along on your phone if you like: every gift, who's up next, and the chat.\n\n` +
      `${url}\n\n${keep}`,
    html:
      `<p>Hi ${escapeHtml(name)},</p>` +
      `<p>You're on the list for <strong>${escapeHtml(gameName)}</strong>.` +
      about.map((l) => `<br>${escapeHtml(l)}`).join("") +
      `</p>` +
      `<p>Bring a wrapped gift for the White Elephant swap. On the day, you can follow along on your phone if you like: every gift, who's up next, and the chat.</p>` +
      `<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background:#b3202e;color:#fff;border-radius:8px;text-decoration:none">Open your invitation</a></p>` +
      `<p>Or open this link: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>` +
      `<p style="color:#666">${escapeHtml(keep)}</p>`,
  };
}
