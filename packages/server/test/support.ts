import type { DrawFn } from "@elephant/rules";
import type { Mailer } from "../src/server.js";

export const post = (body: unknown, cookie?: string) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(body),
});

/** Draws Players in a fixed order, so tests know who is called up. */
export function scriptedDraw(order: string[]): DrawFn {
  const queue = [...order];
  return (candidates) => {
    const next = queue.shift();
    if (!next || !candidates.includes(next)) throw new Error(`script can't draw ${next} from ${candidates.join(",")}`);
    return next;
  };
}

/** Stands in for the email service: keeps every sign-in link instead of sending it. */
export function capturingMailer() {
  const sent: { email: string; url: string }[] = [];
  /** Follow-up emails asking a Host how their Game went. */
  const asked: { email: string; gameName: string; url: string }[] = [];
  const mailer: Mailer = {
    async sendSignInLink(email, url) {
      sent.push({ email, url });
    },
    async sendFeedbackRequest(email, gameName, url) {
      asked.push({ email, gameName, url });
    },
  };
  return { sent, asked, mailer };
}

type App = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

/** The token in the latest link emailed to this address. */
export function tokenFor(sent: { email: string; url: string }[], email: string): string {
  const link = sent.filter((m) => m.email === email).at(-1);
  if (!link) throw new Error(`no link was emailed to ${email}`);
  const token = new URL(link.url).searchParams.get("token");
  if (!token) throw new Error(`no token in ${link.url}`);
  return token;
}

/** Signs in the way a person does (ask for a link, follow it) and returns the session cookie to send. */
export async function signIn(app: App, sent: { email: string; url: string }[], email: string): Promise<string> {
  await app.request("/api/auth/link", post({ email }));
  const res = await app.request("/api/auth/verify", post({ token: tokenFor(sent, email) }));
  const setCookie = res.headers.get("set-cookie");
  if (res.status !== 200 || !setCookie) throw new Error(`sign-in failed with ${res.status}`);
  return setCookie.split(";")[0]!;
}

/** Signs in as a Host and creates a Game; returns its id and the Host's cookie. */
export async function hostGame(app: App, sent: { email: string; url: string }[], settings = { activeSlots: 1, maxSteals: 3 }) {
  const cookie = await signIn(app, sent, "host@example.com");
  const res = await app.request("/api/games", post({ settings }, cookie));
  const { id } = (await res.json()) as { id: string };
  return { id, cookie };
}
