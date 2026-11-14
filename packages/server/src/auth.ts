import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { users, sessions, signInLinks, type Db } from "./db.js";

/** Sends sign-in links. Resend in production; tests capture the links instead. */
export interface Mailer {
  sendSignInLink(email: string, url: string): Promise<void>;
}

/** Until there's a domain to send from, links are written to the server log. */
export const logMailer: Mailer = {
  async sendSignInLink(email, url) {
    console.log(`Sign-in link for ${email}: ${url}`);
  },
};

export const LINK_LIFETIME_MS = 15 * 60_000;
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60_000;

/** 32 random bytes: far beyond guessing. */
const newToken = () => randomBytes(32).toString("base64url");
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export function createAuth(db: Db, now: () => Date) {
  return {
    /** Records a new sign-in link for this email and returns its token. */
    issueLink(email: string): string {
      const token = newToken();
      db.insert(signInLinks)
        .values({ tokenHash: hash(token), email, expiresAt: new Date(now().getTime() + LINK_LIFETIME_MS) })
        .run();
      return token;
    },

    /** Uses up a link and opens a session; undefined if the link is unknown, used or expired. */
    redeemLink(token: string): { sessionToken: string; email: string } | undefined {
      const at = now();
      const link = db
        .update(signInLinks)
        .set({ usedAt: at })
        .where(and(eq(signInLinks.tokenHash, hash(token)), isNull(signInLinks.usedAt), gt(signInLinks.expiresAt, at)))
        .returning()
        .get();
      if (!link) return undefined;

      db.insert(users).values({ id: newToken(), email: link.email, createdAt: at }).onConflictDoNothing().run();
      const user = db.select().from(users).where(eq(users.email, link.email)).get()!;
      const sessionToken = newToken();
      db.insert(sessions)
        .values({ tokenHash: hash(sessionToken), userId: user.id, expiresAt: new Date(at.getTime() + SESSION_LIFETIME_MS) })
        .run();
      return { sessionToken, email: user.email };
    },

    /** The signed-in person's email, or undefined for no session or an expired one. */
    sessionEmail(sessionToken: string | undefined): string | undefined {
      if (!sessionToken) return undefined;
      const row = db
        .select({ email: users.email })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, hash(sessionToken)), gt(sessions.expiresAt, now())))
        .get();
      return row?.email;
    },

    endSession(sessionToken: string): void {
      db.delete(sessions).where(eq(sessions.tokenHash, hash(sessionToken))).run();
    },
  };
}
