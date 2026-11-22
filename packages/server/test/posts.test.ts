import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

type Reaction = { emoji: string; count: number; mine: boolean };
type Quote = { id: string; author: string; text: string; photo: unknown } | { id: string; removed: true };
type Post = {
  id: string;
  author: string;
  giftId: string | null;
  text: string;
  status: string;
  mine: boolean;
  reactions: Reaction[];
  replyTo: Quote | null;
  replies: number;
};

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
  const react = (cookie: string | undefined, postId: string, emoji: string, on = true) =>
    app.request(`/api/games/${id}/posts/${postId}/reactions`, post({ emoji, on }, cookie));
  return { app, id, host, as, write, read, moderate, setStatus, react };
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

  it("under Approval, shows the Host's and a Co-host's own Posts at once", async () => {
    const { app, id, as, write, read, moderate, host } = await setup();
    await moderate(host, "approval");
    const pat = await as("pat@example.com");
    expect((await app.request(`/api/games/${id}/cohosts`, post({ email: "pat@example.com" }, host))).status).toBe(204);

    await write(host, { text: "Welcome, everyone!", name: "The Host" });
    await write(pat, { text: "Grab a cookie", name: "Pat" });

    expect((await read()).map((p) => [p.text, p.status])).toEqual([
      ["Grab a cookie", "visible"],
      ["Welcome, everyone!", "visible"],
    ]);
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

describe("Reactions", () => {
  async function onePost() {
    const s = await setup();
    const gus = await s.as("gus@example.com");
    await s.write(gus, { text: "Socks again!", name: "Gus" });
    const [p] = await s.read();
    return { ...s, gus, postId: p!.id };
  }
  const counts = (p: Post | undefined) => p!.reactions.map((r) => [r.emoji, r.count, r.mine]);

  it("lets anyone signed in react, and shows everyone the counts in a fixed order", async () => {
    const { as, react, read, postId, host } = await onePost();
    const eve = await as("eve@example.com");

    expect((await react(eve, postId, "😂")).status).toBe(204);
    expect((await react(host, postId, "😂")).status).toBe(204);
    expect((await react(host, postId, "👍")).status).toBe(204);

    expect(counts((await read(eve))[0])).toEqual([
      ["👍", 1, false],
      ["😂", 2, true],
    ]);
    expect(counts((await read())[0])).toEqual([
      ["👍", 1, false],
      ["😂", 2, false],
    ]);
  });

  it("counts each person once per reaction, and takes one back on request", async () => {
    const { as, react, read, postId } = await onePost();
    const eve = await as("eve@example.com");
    await react(eve, postId, "❤️");
    await react(eve, postId, "❤️");
    await react(eve, postId, "🔥");
    expect(counts((await read(eve))[0])).toEqual([
      ["❤️", 1, true],
      ["🔥", 1, true],
    ]);

    expect((await react(eve, postId, "❤️", false)).status).toBe(204);
    expect((await react(eve, postId, "❤️", false)).status).toBe(204); // already gone: nothing to do
    expect(counts((await read(eve))[0])).toEqual([["🔥", 1, true]]);
  });

  it("offers only the friendly reactions, holiday ones included", async () => {
    const { as, react, postId } = await onePost();
    const eve = await as("eve@example.com");
    for (const emoji of ["👍", "❤️", "😂", "🎉", "🔥", "😮", "⛄", "leg-lamp"]) expect((await react(eve, postId, emoji)).status).toBe(204);
    for (const emoji of ["👎", "😡", "💩", "x"]) expect((await react(eve, postId, emoji)).status).toBe(400);
  });

  it("needs someone signed in, and a Post they can see", async () => {
    const { as, write, react, read, setStatus, moderate, postId, host } = await onePost();
    const eve = await as("eve@example.com");
    expect((await react(undefined, postId, "👍")).status).toBe(401);
    expect((await react(eve, "nope", "👍")).status).toBe(404);

    await setStatus(host, postId, "hidden");
    expect((await react(eve, postId, "👍")).status).toBe(404);

    await moderate(host, "approval");
    await write(eve, { text: "Mine", name: "Eve" });
    const mine = (await read(eve)).find((p) => p.text === "Mine")!;
    expect((await react(eve, mine.id, "👍")).status).toBe(404); // not until it's approved
  });

  it("still works while posting is Paused", async () => {
    const { as, react, moderate, postId, host } = await onePost();
    await moderate(host, "paused");
    expect((await react(await as("eve@example.com"), postId, "🎉")).status).toBe(204);
  });
});

describe("Replies", () => {
  async function onePost() {
    const s = await setup();
    const pat = await s.as("pat@example.com");
    await s.write(pat, { text: "Stole the lamp!", name: "Pat" });
    const [p] = await s.read();
    return { ...s, pat, original: p!.id };
  }

  it("quotes the Post replied to, and counts the replies on it", async () => {
    const { as, write, read, original } = await onePost();
    const sam = await as("sam@example.com");

    expect((await write(sam, { text: "Third time!", name: "Sam", replyTo: original })).status).toBe(201);

    const [reply, first] = await read();
    expect(reply!.replyTo).toEqual({ id: original, author: "Pat", text: "Stole the lamp!", photo: null });
    expect(first!.replyTo).toBeNull();
    expect([reply!.replies, first!.replies]).toEqual([0, 1]);
  });

  it("can only answer a visible Post in the same Game", async () => {
    const { app, as, write, read, setStatus, host, original } = await onePost();
    const sam = await as("sam@example.com");
    expect((await write(sam, { text: "Hi", name: "Sam", replyTo: "nope" })).status).toBe(400);

    const other = (await (await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 } }, host))).json()) as { id: string };
    expect((await app.request(`/api/games/${other.id}/posts`, post({ text: "Hi", name: "Sam", replyTo: original }, sam))).status).toBe(400);

    await setStatus(host, original, "hidden");
    expect((await write(sam, { text: "Hi", name: "Sam", replyTo: original })).status).toBe(400);
    expect(await read()).toEqual([]);
  });

  it("follows Moderation like any Post, and counts only the replies everyone can see", async () => {
    const { as, write, read, moderate, host, original } = await onePost();
    await moderate(host, "approval");
    const sam = await as("sam@example.com");
    await write(sam, { text: "Third time!", name: "Sam", replyTo: original });

    expect((await read()).map((p) => [p.text, p.replies])).toEqual([["Stole the lamp!", 0]]);
    expect((await read(sam)).map((p) => p.status)).toEqual(["pending", "visible"]);

    await moderate(host, "paused");
    expect((await write(sam, { text: "Again", name: "Sam", replyTo: original })).status).toBe(409);
  });

  it("shows the Post replied to as removed to anyone who can no longer see it", async () => {
    const { as, write, read, setStatus, host, original } = await onePost();
    const sam = await as("sam@example.com");
    await write(sam, { text: "Third time!", name: "Sam", replyTo: original });

    await setStatus(host, original, "hidden");

    expect((await read(sam)).map((p) => p.replyTo)).toEqual([{ id: original, removed: true }]);
    expect((await read(host))[0]!.replyTo).toMatchObject({ id: original, author: "Pat" });
  });
});
