import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, gt, isNull, lte, sql, type SQL } from "drizzle-orm";
import { users, sessions, signInLinks, type Db } from "./db.js";
import { VISITOR_DAYS, VISITOR_DOMAIN } from "./stats.js";

/** Sends sign-in links. Resend in production; tests capture the links instead. */
export interface Mailer {
  sendSignInLink(email: string, url: string): Promise<void>;
  /** Asks a Host, who said it's OK, how their Game went; without it, nobody is asked by email. */
  sendFeedbackRequest?(email: string, gameName: string, url: string): Promise<void>;
  /** Passes a message from the contact form to Jim (the admins); a reply goes straight to `replyTo`, if given. */
  sendContactMessage?(to: readonly string[], message: string, replyTo: string | undefined, from: string): Promise<void>;
}

/** Until there's a domain to send from, links are written to the server log. */
export const logMailer: Mailer = {
  async sendSignInLink(email, url) {
    console.log(`Sign-in link for ${email}: ${url}`);
  },
  async sendFeedbackRequest(email, gameName, url) {
    console.log(`Feedback request for ${email} about ${gameName}: ${url}`);
  },
  async sendContactMessage(to, message, replyTo, from) {
    console.log(`Contact message for ${to.join(", ")} from ${from} (reply to ${replyTo ?? "nobody"}): ${message}`);
  },
};

export const LINK_LIFETIME_MS = 15 * 60_000;
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60_000;

/** How many sign-in links may be emailed. Every email costs quota, and links can be asked for any address. */
export interface LinkLimits {
  /** To one address in 15 minutes: stops anyone flooding someone's inbox. */
  perEmail: number;
  /** From one client IP in an hour. Generous: a whole party may share the venue's Wi-Fi. */
  perIp: number;
  /** In all, in 24 hours: protects the email quota (Resend's free plan allows 100 a day). */
  perDay: number;
}

export const DEFAULT_LIMITS: LinkLimits = { perEmail: 3, perIp: 120, perDay: 100 };

const MINUTE = 60_000;

/** 32 random bytes: far beyond guessing. */
const newToken = () => randomBytes(32).toString("base64url");
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export function createAuth(db: Db, now: () => Date, limits: LinkLimits) {
  /** Asked on nearly every request, so prepared once. */
  const sessionByHash = db
    .select({ email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sql.placeholder("hash")), gt(sessions.expiresAt, sql.placeholder("now"))))
    .prepare();
  /** Links asked for in the last `minutes` that match the condition. */
  const recent = (minutes: number, where?: SQL) =>
    db
      .select({ n: count() })
      .from(signInLinks)
      .where(and(gt(signInLinks.requestedAt, new Date(now().getTime() - minutes * MINUTE)), where))
      .get()!.n;

  return {
    /**
     * Records a new sign-in link and returns its token, or undefined if a limit has been reached. `feedbackOk`:
     * they ticked "OK to email me for feedback", which takes effect once the link is used.
     */
    issueLink(email: string, clientIp: string, feedbackOk = false, ref: string | null = null): string | undefined {
      if (
        recent(15, eq(signInLinks.email, email)) >= limits.perEmail ||
        recent(60, eq(signInLinks.clientIp, clientIp)) >= limits.perIp ||
        recent(24 * 60) >= limits.perDay
      ) {
        return undefined;
      }
      const token = newToken();
      const at = now();
      db.insert(signInLinks)
        .values({ tokenHash: hash(token), email, clientIp, feedbackOk, ref, requestedAt: at, expiresAt: new Date(at.getTime() + LINK_LIFETIME_MS) })
        .run();
      return token;
    },

    /** Uses up a link and opens a session; undefined if the link is unknown, used or expired. */
    redeemLink(token: string): { sessionToken: string; email: string; ref: string | null } | undefined {
      const at = now();
      const link = db
        .update(signInLinks)
        .set({ usedAt: at })
        .where(and(eq(signInLinks.tokenHash, hash(token)), isNull(signInLinks.usedAt), gt(signInLinks.expiresAt, at)))
        .returning()
        .get();
      if (!link) return undefined;

      db.insert(users).values({ id: newToken(), email: link.email, createdAt: at }).onConflictDoNothing().run();
      // A box left unticked on a later sign-in doesn't take back a yes; the home screen is where they change it.
      db.update(users)
        .set({ lastSignInAt: at, ...(link.feedbackOk ? { feedbackOk: true } : {}) })
        .where(eq(users.email, link.email))
        .run();
      const user = db.select().from(users).where(eq(users.email, link.email)).get()!;
      const sessionToken = newToken();
      db.insert(sessions)
        .values({ tokenHash: hash(sessionToken), userId: user.id, expiresAt: new Date(at.getTime() + SESSION_LIFETIME_MS) })
        .run();
      return { sessionToken, email: user.email, ref: link.ref };
    },

    /**
     * A session for someone trying the demo without signing in: a stand-in user (see VISITOR_DOMAIN) that lasts
     * VISITOR_DAYS. No email is sent; the cookie is all they need.
     */
    startVisitor(): { sessionToken: string; email: string } {
      const at = now();
      const email = `visitor-${newToken().slice(0, 16).toLowerCase()}@${VISITOR_DOMAIN}`;
      const userId = newToken();
      db.insert(users).values({ id: userId, email, createdAt: at, lastSignInAt: at }).run();
      const sessionToken = newToken();
      db.insert(sessions)
        .values({ tokenHash: hash(sessionToken), userId, expiresAt: new Date(at.getTime() + VISITOR_DAYS * 24 * 60 * MINUTE) })
        .run();
      return { sessionToken, email };
    },

    /** The signed-in person's email, or undefined for no session or an expired one. */
    sessionEmail(sessionToken: string | undefined): string | undefined {
      if (!sessionToken) return undefined;
      return sessionByHash.get({ hash: hash(sessionToken), now: now().getTime() })?.email;
    },

    endSession(sessionToken: string): void {
      db.delete(sessions).where(eq(sessions.tokenHash, hash(sessionToken))).run();
    },

    /**
     * Deletes sign-in links once the day-long limit no longer counts them (with the IP addresses they hold),
     * and sessions that have expired. Returns how many of each went.
     */
    sweep(): { links: number; sessions: number } {
      const at = now();
      const links = db
        .delete(signInLinks)
        .where(lte(signInLinks.requestedAt, new Date(at.getTime() - 24 * 60 * MINUTE)))
        .run().changes;
      const expired = db.delete(sessions).where(lte(sessions.expiresAt, at)).run().changes;
      return { links, sessions: expired };
    },
  };
}
