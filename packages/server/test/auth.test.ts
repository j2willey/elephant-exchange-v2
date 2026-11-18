import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, hostGame, post, signIn, tokenFor } from "./support.js";

function setup() {
  let now = new Date("2026-12-13T18:00:00Z");
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer, now: () => now, baseUrl: "https://elephant.test" });
  const advance = (minutes: number) => (now = new Date(now.getTime() + minutes * 60_000));
  return { app, sent, advance };
}

describe("Signing in by emailed link", () => {
  it("emails a link to the sign-in page; following it signs the person in", async () => {
    const { app, sent } = setup();

    const asked = await app.request("/api/auth/link", post({ email: "  Ann@Example.com " }));

    expect(asked.status).toBe(202);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.email).toBe("ann@example.com");
    expect(sent[0]!.url).toMatch(/^https:\/\/elephant\.test\/sign-in\?token=[A-Za-z0-9_-]{40,}$/);

    const cookie = await signIn(app, sent, "ann@example.com");
    const me = await app.request("/api/session", { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ email: "ann@example.com", feedbackOk: false, tipNoteRead: false, admin: false });
  });

  it("marks the session cookie HttpOnly so page scripts can't read it", async () => {
    const { app, sent } = setup();
    await app.request("/api/auth/link", post({ email: "ann@example.com" }));
    const res = await app.request("/api/auth/verify", post({ token: tokenFor(sent, "ann@example.com") }));
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(res.headers.get("set-cookie")).toMatch(/SameSite=Lax/i);
  });

  it("refuses a link the second time it is used", async () => {
    const { app, sent } = setup();
    await app.request("/api/auth/link", post({ email: "ann@example.com" }));
    const token = tokenFor(sent, "ann@example.com");

    expect((await app.request("/api/auth/verify", post({ token }))).status).toBe(200);
    expect((await app.request("/api/auth/verify", post({ token }))).status).toBe(401);
  });

  it("refuses a link more than 15 minutes old", async () => {
    const { app, sent, advance } = setup();
    await app.request("/api/auth/link", post({ email: "ann@example.com" }));
    const token = tokenFor(sent, "ann@example.com");

    advance(16);

    expect((await app.request("/api/auth/verify", post({ token }))).status).toBe(401);
  });

  it("accepts a link just inside 15 minutes", async () => {
    const { app, sent, advance } = setup();
    await app.request("/api/auth/link", post({ email: "ann@example.com" }));
    advance(14);
    expect((await app.request("/api/auth/verify", post({ token: tokenFor(sent, "ann@example.com") }))).status).toBe(200);
  });

  it("refuses a made-up token, and a malformed email address", async () => {
    const { app } = setup();
    expect((await app.request("/api/auth/verify", post({ token: "x".repeat(43) }))).status).toBe(401);
    expect((await app.request("/api/auth/link", post({ email: "not-an-email" }))).status).toBe(400);
  });

  it("knows nobody without a session, and signs out", async () => {
    const { app, sent } = setup();
    expect((await app.request("/api/session")).status).toBe(401);

    const cookie = await signIn(app, sent, "ann@example.com");
    expect((await app.request("/api/auth/sign-out", { method: "POST", headers: { cookie } })).status).toBe(204);
    expect((await app.request("/api/session", { headers: { cookie } })).status).toBe(401);
  });
});

describe("Who may run a Game", () => {
  it("needs a signed-in person to create a Game", async () => {
    const { app } = setup();
    expect((await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 } }))).status).toBe(401);
  });

  it("lets the Host send commands, but nobody signed out (401) or anybody else (403)", async () => {
    const { app, sent } = setup();
    const { id, cookie: host } = await hostGame(app, sent);
    const stranger = await signIn(app, sent, "stranger@example.com");
    const addAnn = { type: "AddPlayer", playerId: "ann", name: "Ann" };

    expect((await app.request(`/api/games/${id}/commands`, post(addAnn))).status).toBe(401);
    expect((await app.request(`/api/games/${id}/commands`, post(addAnn, stranger))).status).toBe(403);
    expect((await app.request(`/api/games/${id}/commands`, post(addAnn, host))).status).toBe(200);
  });

  it("lets the Host make someone a Co-host, who can then send commands", async () => {
    const { app, sent } = setup();
    const { id, cookie: host } = await hostGame(app, sent);

    const added = await app.request(`/api/games/${id}/cohosts`, post({ email: "Bob@Example.com" }, host));
    expect(added.status).toBe(204);

    const bob = await signIn(app, sent, "bob@example.com");
    const res = await app.request(`/api/games/${id}/commands`, post({ type: "AddPlayer", playerId: "ann", name: "Ann" }, bob));
    expect(res.status).toBe(200);
  });

  it("lets only the Host appoint Co-hosts", async () => {
    const { app, sent } = setup();
    const { id, cookie: host } = await hostGame(app, sent);
    await app.request(`/api/games/${id}/cohosts`, post({ email: "bob@example.com" }, host));
    const bob = await signIn(app, sent, "bob@example.com");

    expect((await app.request(`/api/games/${id}/cohosts`, post({ email: "cat@example.com" }))).status).toBe(401);
    expect((await app.request(`/api/games/${id}/cohosts`, post({ email: "cat@example.com" }, bob))).status).toBe(403);
  });

  it("lists a Game's Co-hosts, and lets only the Host remove one", async () => {
    const { app, sent } = setup();
    const { id, cookie: host } = await hostGame(app, sent);
    await app.request(`/api/games/${id}/cohosts`, post({ email: "bob@example.com" }, host));
    await app.request(`/api/games/${id}/cohosts`, post({ email: "cat@example.com" }, host));
    const bob = await signIn(app, sent, "bob@example.com");
    const list = async (cookie: string) => (await (await app.request(`/api/games/${id}/cohosts`, { headers: { cookie } })).json()).cohosts;

    expect(await list(bob)).toEqual(["bob@example.com", "cat@example.com"]);
    expect((await app.request(`/api/games/${id}/cohosts/cat%40example.com`, { method: "DELETE", headers: { cookie: bob } })).status).toBe(403);
    // The Host's own row can't be removed this way.
    const self = await app.request(`/api/games/${id}/cohosts/host%40example.com`, { method: "DELETE", headers: { cookie: host } });
    expect(self.status).toBe(204);
    expect((await app.request(`/api/games/${id}/cohosts/Cat%40Example.com`, { method: "DELETE", headers: { cookie: host } })).status).toBe(204);
    expect(await list(host)).toEqual(["bob@example.com"]);

    const stranger = await signIn(app, sent, "dan@example.com");
    expect((await app.request(`/api/games/${id}/cohosts`, { headers: { cookie: stranger } })).status).toBe(403);
  });
});
