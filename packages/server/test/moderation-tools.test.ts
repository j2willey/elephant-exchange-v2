import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

type Post = {
  id: string;
  text: string;
  author: string;
  status: string;
  replies: number;
  authorMuted?: boolean;
  authorMutedSeconds?: number | null;
  replyTo: { removed?: true } | null;
  reactions: unknown[];
};

const MINUTE = 60_000;
const photosDirs: string[] = [];
afterEach(() => {
  for (const d of photosDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** An Open Game with a thread: Gus posts, Dot replies, Gus replies to Dot, and Eve replies too. Eve also posts on her own. */
async function setup() {
  const { sent, mailer } = capturingMailer();
  let at = Date.UTC(2026, 11, 13, 19);
  const photosDir = mkdtempSync(join(tmpdir(), "elephant-moderation-"));
  photosDirs.push(photosDir);
  const { app } = createServer({ dbPath: ":memory:", mailer, photosDir, now: () => new Date(at) });
  const later = (ms: number) => void (at += ms);
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
  const game = async (cookie: string) => (await (await app.request(`/api/games/${id}`, { headers: { cookie } })).json()) as { muted: boolean; mutedSeconds: number | null };
  const remove = (postId: string, cookie = host) => app.request(`/api/games/${id}/posts/${postId}`, { method: "DELETE", headers: { cookie } });
  return { app, id, host, gus, dot, eve, as, write, read, find, setStatus, mute, game, later, remove, photosDir };
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

describe("Muting a poster for a while", () => {
  it("lets them post again once the time is up, by itself, and says how long is left meanwhile", async () => {
    const { find, mute, write, gus, game, later } = await setup();
    const postId = (await find("Rude start")).id;
    expect((await mute(postId, { muted: true, minutes: 15 })).status).toBe(204);
    expect(await game(gus)).toMatchObject({ muted: true, mutedSeconds: 15 * 60 });
    expect((await find("Rude start")).authorMutedSeconds).toBe(15 * 60);

    later(10 * MINUTE);
    expect((await write(gus, { text: "Too soon" })).status).toBe(409);
    expect((await game(gus)).mutedSeconds).toBe(5 * 60);

    later(5 * MINUTE);
    expect(await game(gus)).toMatchObject({ muted: false, mutedSeconds: null });
    expect((await find("Rude start")).authorMuted).toBe(false);
    expect((await write(gus, { text: "Sorry" })).status).toBe(201);
  });

  it("keeps the Posts the mute hid hidden when the time is up, for the Host to show again one by one", async () => {
    const { find, mute, read, setStatus, later } = await setup();
    await mute((await find("Rude start")).id, { muted: true, hidePosts: true, minutes: 15 });
    later(15 * MINUTE);
    expect(visible(await read())).toEqual(["Dot replies", "Eve alone", "Eve replies"]);
    await setStatus((await find("Rude start")).id, { status: "visible" });
    expect(visible(await read())).toEqual(["Dot replies", "Eve alone", "Eve replies", "Rude start"]);
  });

  it("lasts until unmuted when no time is given, as before", async () => {
    const { find, mute, write, gus, game, later } = await setup();
    await mute((await find("Rude start")).id, { muted: true });
    later(24 * 60 * MINUTE);
    expect(await game(gus)).toMatchObject({ muted: true, mutedSeconds: null });
    expect((await write(gus, { text: "Still no" })).status).toBe(409);
  });

  it("can be ended early by unmuting, or changed by muting again", async () => {
    const { find, mute, write, gus, game } = await setup();
    const postId = (await find("Rude start")).id;
    await mute(postId, { muted: true, minutes: 60 });
    await mute(postId, { muted: true, minutes: 15 });
    expect((await game(gus)).mutedSeconds).toBe(15 * 60);
    await mute(postId, { muted: false });
    expect((await write(gus, { text: "Back" })).status).toBe(201);
  });

  it("refuses a time that isn't a whole number of minutes, up to a day", async () => {
    const { find, mute } = await setup();
    const postId = (await find("Rude start")).id;
    for (const minutes of [0, -5, 2.5, 24 * 60 + 1]) expect((await mute(postId, { muted: true, minutes })).status).toBe(400);
  });
});

describe("Deleting a Post for good", () => {
  const photo = () => sharp({ create: { width: 64, height: 48, channels: 3, background: "#c33" } }).jpeg().toBuffer();

  it("removes it, its Reactions and its Photo, for everyone, its poster included; replies stay, quoting it as removed", async () => {
    const { app, id, find, read, remove, gus, eve, photosDir } = await setup();
    const form = new FormData();
    form.append("text", "Really bad");
    form.append("photo", new Blob([new Uint8Array(await photo())], { type: "image/jpeg" }), "p.jpg");
    expect((await app.request(`/api/games/${id}/posts`, { method: "POST", body: form, headers: { cookie: gus } })).status).toBe(201);
    const bad = await find("Really bad");
    await app.request(`/api/games/${id}/posts/${bad.id}/reactions`, post({ emoji: "👍", on: true }, eve));
    await app.request(`/api/games/${id}/posts`, post({ text: "Yikes", replyTo: bad.id }, eve));
    expect(readdirSync(join(photosDir, id)).some((f) => f.startsWith(bad.id))).toBe(true);

    expect((await remove(bad.id)).status).toBe(204);

    for (const who of [undefined, gus, eve]) expect((await read(who)).map((p) => p.text)).not.toContain("Really bad");
    expect((await find("Yikes")).replyTo).toEqual({ id: bad.id, removed: true });
    expect(existsSync(join(photosDir, id)) && readdirSync(join(photosDir, id)).some((f) => f.startsWith(bad.id))).toBe(false);
    expect((await app.request(`/api/games/${id}/posts/${bad.id}/photo.jpg`, { headers: { cookie: gus } })).status).toBe(404);
  });

  it("leaves the replies hidden along with it hidden, each one able to be shown again", async () => {
    const { find, read, remove, setStatus } = await setup();
    const rude = await find("Rude start");
    await setStatus(rude.id, { status: "hidden", thread: true });
    expect((await remove(rude.id)).status).toBe(204);
    expect(visible(await read())).toEqual(["Eve alone"]);
    expect((await setStatus((await find("Dot replies")).id, { status: "visible" })).status).toBe(204);
    expect(visible(await read())).toEqual(["Dot replies", "Eve alone"]);
  });

  it("is only for the Host and Co-hosts, not even the poster", async () => {
    const { find, remove, gus, eve } = await setup();
    const rude = await find("Rude start");
    expect((await remove(rude.id, gus)).status).toBe(403);
    expect((await remove(rude.id, eve)).status).toBe(403);
    expect((await remove("no-such-post")).status).toBe(404);
  });
});
