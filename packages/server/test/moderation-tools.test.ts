import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

type Post = { id: string; text: string; author: string; status: string; replies: number; authorMuted?: boolean };

/** An Open Game with a thread: Gus posts, Dot replies, Gus replies to Dot, and Eve replies too. Eve also posts on her own. */
async function setup() {
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer });
  const host = await signIn(app, sent, "host@example.com");
  const { id } = (await (await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 } }, host))).json()) as { id: string };
  const as = (email: string) => signIn(app, sent, email);
  const write = async (cookie: string, body: Record<string, unknown>) => app.request(`/api/games/${id}/posts`, post(body, cookie));
  const read = async (cookie?: string) => (await (await app.request(`/api/games/${id}/posts`, cookie ? { headers: { cookie } } : {})).json()) as Post[];
  const find = async (text: string, cookie = host) => (await read(cookie)).find((p) => p.text === text)!;
  const gus = await as("gus@example.com");
  const dot = await as("dot@example.com");
  const eve = await as("eve@example.com");
  await write(gus, { text: "Rude start", name: "Gus" });
  await write(dot, { text: "Dot replies", name: "Dot", replyTo: (await find("Rude start")).id });
  await write(gus, { text: "Gus again", replyTo: (await find("Dot replies")).id });
  await write(eve, { text: "Eve replies", name: "Eve", replyTo: (await find("Rude start")).id });
  await write(eve, { text: "Eve alone" });
  const setStatus = (postId: string, body: Record<string, unknown>, cookie = host) =>
    app.request(`/api/games/${id}/posts/${postId}/status`, post(body, cookie));
  const mute = (postId: string, body: Record<string, unknown>, cookie = host) => app.request(`/api/games/${id}/mute`, post({ postId, ...body }, cookie));
  const game = async (cookie: string) => (await (await app.request(`/api/games/${id}`, { headers: { cookie } })).json()) as { muted: boolean };
  return { app, id, host, gus, dot, eve, as, write, read, find, setStatus, mute, game };
}

const visible = (posts: Post[]) => posts.map((p) => p.text).sort();

describe("Hiding a thread", () => {
  it("hides a Post with every reply under it, replies to replies included", async () => {
    const { find, setStatus, read } = await setup();
    expect((await setStatus((await find("Rude start")).id, { status: "hidden", thread: true })).status).toBe(204);
    expect(visible(await read())).toEqual(["Eve alone"]);
  });

  it("brings the thread back when the Post is shown again, but not a reply hidden on its own", async () => {
    const { find, setStatus, read } = await setup();
    await setStatus((await find("Eve replies")).id, { status: "hidden" });
    await setStatus((await find("Rude start")).id, { status: "hidden", thread: true });

    await setStatus((await find("Rude start")).id, { status: "visible" });

    expect(visible(await read())).toEqual(["Dot replies", "Eve alone", "Gus again", "Rude start"]);
  });

  it("hides just the one Post when the thread isn't asked for, as before", async () => {
    const { find, setStatus, read } = await setup();
    await setStatus((await find("Rude start")).id, { status: "hidden" });
    expect(visible(await read())).toEqual(["Dot replies", "Eve alone", "Eve replies", "Gus again"]);
  });
});

describe("Muting a poster", () => {
  it("stops them posting and replying, and tells their phone", async () => {
    const { find, mute, write, gus, game } = await setup();
    expect((await mute((await find("Rude start")).id, { muted: true })).status).toBe(204);

    const res = await write(gus, { text: "Can't stop me" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "Muted" });
    expect((await write(gus, { text: "Nor this", replyTo: (await find("Eve alone")).id })).status).toBe(409);
    expect((await game(gus)).muted).toBe(true);
  });

  it("leaves their Posts up unless asked to hide them, and still lets them react", async () => {
    const { app, id, find, mute, read, gus } = await setup();
    await mute((await find("Rude start")).id, { muted: true });
    expect(visible(await read())).toContain("Rude start");
    const react = await app.request(`/api/games/${id}/posts/${(await find("Eve alone")).id}/reactions`, post({ emoji: "👍", on: true }, gus));
    expect(react.status).toBe(204);
  });

  it("can hide everything they've posted, and unmuting brings back only what the mute hid", async () => {
    const { find, mute, read, setStatus } = await setup();
    await setStatus((await find("Gus again")).id, { status: "hidden" });
    await mute((await find("Rude start")).id, { muted: true, hidePosts: true });
    expect(visible(await read())).toEqual(["Dot replies", "Eve alone", "Eve replies"]);

    await mute((await find("Rude start")).id, { muted: false });
    expect(visible(await read())).toEqual(["Dot replies", "Eve alone", "Eve replies", "Rude start"]);
  });

  it("lets them post again once unmuted", async () => {
    const { find, mute, write, gus, game } = await setup();
    const postId = (await find("Rude start")).id;
    await mute(postId, { muted: true });
    await mute(postId, { muted: false });
    expect((await write(gus, { text: "Sorry" })).status).toBe(201);
    expect((await game(gus)).muted).toBe(false);
  });

  it("marks a muted poster's Posts for the Host and Co-hosts only", async () => {
    const { find, mute, read, eve } = await setup();
    await mute((await find("Rude start")).id, { muted: true });
    expect((await find("Rude start")).authorMuted).toBe(true);
    expect((await find("Eve alone")).authorMuted).toBe(false);
    expect((await read(eve)).find((p) => p.text === "Rude start")!.authorMuted).toBeUndefined();
  });

  it("is only for the Host and Co-hosts", async () => {
    const { find, mute, eve } = await setup();
    expect((await mute((await find("Rude start")).id, { muted: true }, eve)).status).toBe(403);
  });
});
