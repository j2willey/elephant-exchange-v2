import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

type Post = { id: string; author: string; giftId: string | null; text: string; status: string; mine: boolean };

async function setup() {
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer, draw: (c) => c[0]! });
  const host = await signIn(app, sent, "host@example.com");
  const res = await app.request("/api/games", post({ rosterMode: "self", settings: { activeSlots: 1, maxSteals: 3 } }, host));
  const { id } = (await res.json()) as { id: string };
  const command = (cmd: unknown) => app.request(`/api/games/${id}/commands`, post(cmd, host));
  for (const p of ["ann", "bob"]) await command({ type: "AddPlayer", playerId: p, name: p.toUpperCase() });
  await command({ type: "StartGame" });
  await command({ type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });
  const as = (email: string) => signIn(app, sent, email);
  const write = (cookie: string | undefined, body: unknown) => app.request(`/api/games/${id}/posts`, post(body, cookie));
  const read = async (cookie?: string) =>
    (await (await app.request(`/api/games/${id}/posts`, cookie ? { headers: { cookie } } : {})).json()) as Post[];
  const moderate = (cookie: string, mode: string) => app.request(`/api/games/${id}/moderation`, post({ mode }, cookie));
  const setStatus = (cookie: string, postId: string, status: string) =>
    app.request(`/api/games/${id}/posts/${postId}/status`, post({ status }, cookie));
  return { app, id, host, as, write, read, moderate, setStatus };
}

describe("Posting", () => {
  it("needs a signed-in person, a few words, and a name for a Guest", async () => {
    const { as, write } = await setup();
    const gus = await as("gus@example.com");

    expect((await write(undefined, { text: "Hi", name: "Gus" })).status).toBe(401);
    expect((await write(gus, { text: "   ", name: "Gus" })).status).toBe(400);
    expect((await write(gus, { text: "x".repeat(501), name: "Gus" })).status).toBe(400);
    expect((await write(gus, { text: "Hi" })).status).toBe(400);
    expect((await write(gus, { text: "Hi", name: "Gus" })).status).toBe(201);
  });

  it("can only be about a Gift that's in the Game", async () => {
    const { as, write } = await setup();
    const gus = await as("gus@example.com");
    expect((await write(gus, { text: "Hi", name: "Gus", giftId: "nope" })).status).toBe(400);
    expect((await write(gus, { text: "Hi", name: "Gus", giftId: "g1" })).status).toBe(201);
  });

  it("uses a Player's own name, whatever name is sent", async () => {
    const { app, id, as, write, read } = await setup();
    const dan = await as("dan@example.com");
    await app.request(`/api/games/${id}/join`, post({ name: "Dan" }, dan));

    await write(dan, { text: "Hi", name: "The Host" });

    expect((await read()).map((p) => p.author)).toEqual(["Dan"]);
  });

  it("never shows anyone's email address", async () => {
    const { as, write, read, host } = await setup();
    await write(await as("gus@example.com"), { text: "Hi", name: "Gus" });
    expect(JSON.stringify(await read(host))).not.toContain("@example.com");
  });
});

describe("Moderation", () => {
  it("can be switched only by the Host or a Co-host", async () => {
    const { as, moderate, host } = await setup();
    expect((await moderate(await as("gus@example.com"), "paused")).status).toBe(403);
    expect((await moderate(host, "sideways")).status).toBe(400);
    expect((await moderate(host, "paused")).status).toBe(204);
  });

  it("when Paused, refuses new Posts", async () => {
    const { as, write, moderate, host } = await setup();
    await moderate(host, "paused");
    expect((await write(await as("gus@example.com"), { text: "Hi", name: "Gus" })).status).toBe(409);
  });

  it("under Approval, shows a Pending Post only to its poster and the Host until it's approved", async () => {
    const { as, write, read, moderate, setStatus, host } = await setup();
    await moderate(host, "approval");
    const gus = await as("gus@example.com");
    const eve = await as("eve@example.com");
    await write(gus, { text: "Is this on?", name: "Gus" });

    expect(await read(eve)).toEqual([]);
    expect(await read()).toEqual([]);
    expect((await read(gus)).map((p) => [p.status, p.mine])).toEqual([["pending", true]]);
    const [pending] = await read(host);

    expect((await setStatus(gus, pending!.id, "visible")).status).toBe(403);
    expect((await setStatus(host, pending!.id, "visible")).status).toBe(204);
    expect((await read(eve)).map((p) => p.text)).toEqual(["Is this on?"]);
  });

  it("lets the Host hide a Post from everyone but its poster", async () => {
    const { as, write, read, setStatus, host } = await setup();
    const gus = await as("gus@example.com");
    await write(gus, { text: "Rude", name: "Gus" });
    const [rude] = await read();

    expect((await setStatus(host, rude!.id, "hidden")).status).toBe(204);

    expect(await read()).toEqual([]);
    expect((await read(gus)).map((p) => p.status)).toEqual(["hidden"]);
    expect((await read(host)).map((p) => p.status)).toEqual(["hidden"]);
    expect((await setStatus(host, "nope", "hidden")).status).toBe(404);
  });
});
