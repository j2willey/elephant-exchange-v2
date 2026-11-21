import { describe, expect, it } from "vitest";
import type { Mailer } from "../src/auth.js";
import { CONTACTS_PER_HOUR, createServer } from "../src/server.js";
import { post, signIn } from "./support.js";

/** A server whose admin is Jim, keeping the sign-in links and contact emails it would send. */
function setup() {
  const sent: { email: string; url: string }[] = [];
  const messages: { to: readonly string[]; message: string; replyTo: string | undefined; from: string }[] = [];
  const mailer: Mailer = {
    async sendSignInLink(email, url) {
      sent.push({ email, url });
    },
    async sendContactMessage(to, message, replyTo, from) {
      messages.push({ to, message, replyTo, from });
    },
  };
  const { app } = createServer({ dbPath: ":memory:", mailer, adminEmails: ["jim@example.org"] });
  const contact = (body: unknown, cookie?: string) => app.request("/api/contact", post(body, cookie));
  const feedbackPage = async () => {
    const jim = await signIn(app, sent, "jim@example.org");
    return (await (await app.request("/api/admin/feedback", { headers: { cookie: jim } })).json()) as { items: { comment: string; replyTo: string | null; from: string | null }[] };
  };
  return { app, sent, messages, contact, feedbackPage };
}

describe("The contact form", () => {
  it("passes a visitor's message to Jim by email, so a reply goes straight to them, and keeps it on the Feedback page", async () => {
    const { messages, contact, feedbackPage } = setup();

    expect((await contact({ message: "Does it work for 200 people?", replyTo: "planner@example.com" })).status).toBe(204);

    expect(messages).toEqual([{ to: ["jim@example.org"], message: "Does it work for 200 people?", replyTo: "planner@example.com", from: "a visitor" }]);
    expect((await feedbackPage()).items).toContainEqual(expect.objectContaining({ comment: "Does it work for 200 people?", replyTo: "planner@example.com", from: null }));
  });

  it("needs no reply address, and uses a signed-in Host's own", async () => {
    const { app, sent, messages, contact } = setup();
    await contact({ message: "Just saying hi" });
    const ann = await signIn(app, sent, "ann@example.com");
    await contact({ message: "Love it", replyTo: "" }, ann);

    expect(messages.map((m) => [m.replyTo, m.from])).toEqual([
      [undefined, "a visitor"],
      ["ann@example.com", "a signed-in Host"],
    ]);
  });

  it("turns away an address that isn't one, and an empty message", async () => {
    const { contact } = setup();
    expect((await contact({ message: "Hi", replyTo: "not an address" })).status).toBe(400);
    expect((await contact({ message: "   " })).status).toBe(400);
  });

  it("quietly drops what a bot sends (it fills in the field people never see)", async () => {
    const { messages, contact, feedbackPage } = setup();

    expect((await contact({ message: "Cheap pills", website: "http://spam.example" })).status).toBe(204);

    expect(messages).toEqual([]);
    expect((await feedbackPage()).items).toEqual([]);
  });

  it(`takes at most ${CONTACTS_PER_HOUR} messages an hour from one address`, async () => {
    const { contact } = setup();
    for (let i = 0; i < CONTACTS_PER_HOUR; i++) expect((await contact({ message: `Message ${i}` })).status).toBe(204);
    expect((await contact({ message: "One more" })).status).toBe(429);
  });
});
