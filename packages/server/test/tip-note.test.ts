import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

/** Jim's note, shown when a Host starts a New Game until they tick that they've read and considered it. */
describe("Jim's tip note", () => {
  async function setup() {
    const { sent, mailer } = capturingMailer();
    const { app } = createServer({ dbPath: ":memory:", mailer, adminEmails: ["boss@willey.test"] });
    const as = (email: string) => signIn(app, sent, email);
    const session = async (cookie: string) => (await (await app.request("/api/session", { headers: { cookie } })).json()) as { tipNoteRead: boolean };
    return { app, as, session };
  }

  it("is unread for someone new, and stays read once they say so, for that person only", async () => {
    const { app, as, session } = await setup();
    const ann = await as("ann@willey.test");
    const bob = await as("bob@willey.test");
    expect((await session(ann)).tipNoteRead).toBe(false);

    expect((await app.request("/api/me/tip-note-read", post({}, ann))).status).toBe(204);

    expect((await session(ann)).tipNoteRead).toBe(true);
    expect((await session(await as("ann@willey.test"))).tipNoteRead).toBe(true); // signed in again
    expect((await session(bob)).tipNoteRead).toBe(false);
  });

  it("can't be marked by someone who isn't signed in", async () => {
    const { app } = await setup();
    expect((await app.request("/api/me/tip-note-read", post({}))).status).toBe(401);
  });

  it("shows on the admin page's list of people", async () => {
    const { app, as } = await setup();
    const ann = await as("ann@willey.test");
    await app.request("/api/me/tip-note-read", post({}, ann));
    const admin = await as("boss@willey.test");

    const people = (await (await app.request("/api/admin/people", { headers: { cookie: admin } })).json()) as { email: string; tipNoteRead: boolean }[];
    expect(people.find((p) => p.email === "ann@willey.test")!.tipNoteRead).toBe(true);
    expect(people.find((p) => p.email === "boss@willey.test")!.tipNoteRead).toBe(false);
  });
});
