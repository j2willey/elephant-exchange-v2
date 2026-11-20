import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

type Part = {
  id: string;
  author: string;
  giftId: string | null;
  text: string;
  status: string;
  pitchFor: string | null;
  tagline: string | null;
  photo: { url: string } | null;
  bumpedAt: number | null;
};
const jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg().toBuffer();
const put = (body: unknown, cookie: string) => ({ ...post(body, cookie), method: "PUT" });

/**
 * Gus and Hal join on their phones, Cat is typed in by the Host. Gus opens the Fruitcake; Hal is up next.
 * Players are drawn in the order they joined.
 */
async function setup() {
  const { sent, mailer } = capturingMailer();
  let ms = Date.UTC(2026, 11, 13, 19, 0, 0);
  const minutes = (n: number) => (ms += n * 60_000);
  const { app } = createServer({ dbPath: ":memory:", mailer, draw: (w) => w[0]!, now: () => new Date(ms), photosDir: mkdtempSync(joinPath(tmpdir(), "pitch-photos-")) });
  const as = (email: string) => signIn(app, sent, email);
  const host = await as("host@example.com");
  const { id } = (await (await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 }, rosterMode: "self" }, host))).json()) as { id: string };
  const send = (cmd: unknown) => app.request(`/api/games/${id}/commands`, post(cmd, host));
  const join = async (email: string, name: string) => {
    const cookie = await as(email);
    const { me } = (await (await app.request(`/api/games/${id}/join`, post({ name }, cookie))).json()) as { me: { playerId: string } };
    return { cookie, playerId: me.playerId };
  };
  const gus = await join("gus@example.com", "Gus");
  const hal = await join("hal@example.com", "Hal");
  await send({ type: "AddPlayer", playerId: "cat", name: "Cat" });
  await send({ type: "StartGame" });
  await send({ type: "OpenGift", playerId: gus.playerId, giftId: "cake", name: "Fruitcake" });
  const pitch = (cookie: string, text: string, extra: Record<string, unknown> = {}, giftId = "cake") =>
    app.request(`/api/games/${id}/gifts/${giftId}/pitch`, put({ text, ...extra }, cookie));
  const parts = async (cookie?: string) =>
    ((await (await app.request(`/api/games/${id}/posts`, cookie ? { headers: { cookie } } : {})).json()) as Part[]).filter((p) => p.pitchFor !== null);
  const again = (cookie: string, extra: Record<string, unknown> = {}) => app.request(`/api/games/${id}/gifts/cake/pitch/again`, post(extra, cookie));
  const feed = async () => ((await (await app.request(`/api/games/${id}/posts`)).json()) as Part[]).map((p) => p.text);
  return { app, id, host, gus, hal, as, send, pitch, parts, again, feed, minutes };
}

describe("A Gift's pitch", () => {
  it("is written by the Gift's holder, signed with their name, and seen by everyone", async () => {
    const { gus, hal, pitch, parts } = await setup();
    expect((await pitch(hal.cookie, "Steal me")).status).toBe(403); // Hal doesn't hold it
    expect((await pitch(gus.cookie, "Grandma's recipe. Probably.")).status).toBe(204);

    expect(await parts()).toEqual([expect.objectContaining({ author: "Gus", giftId: "cake", text: "Grandma's recipe. Probably.", status: "visible", pitchFor: gus.playerId })]);
  });

  it("builds up when the Gift is stolen: the new holder adds a part, newest on top, and the old part stays", async () => {
    const { gus, hal, send, pitch, parts } = await setup();
    await pitch(gus.cookie, "Grandma's recipe. Probably.");
    await send({ type: "Steal", playerId: hal.playerId, giftId: "cake" });

    expect((await pitch(hal.cookie, "Mine now. It's a doorstop.")).status).toBe(204);
    expect((await parts()).map((p) => `${p.author}: ${p.text}`)).toEqual(["Hal: Mine now. It's a doorstop.", "Gus: Grandma's recipe. Probably."]);

    // Gus no longer holds it, but his part is still his to change, and only his.
    expect((await pitch(gus.cookie, "Grandma's recipe. Definitely.")).status).toBe(204);
    expect((await pitch(gus.cookie, "Hal is wrong", { playerId: hal.playerId })).status).toBe(403);
    expect((await parts()).map((p) => p.text)).toEqual(["Mine now. It's a doorstop.", "Grandma's recipe. Definitely."]);
  });

  it("is removed by saving it empty", async () => {
    const { gus, pitch, parts } = await setup();
    await pitch(gus.cookie, "Grandma's recipe.");
    expect((await pitch(gus.cookie, "  ")).status).toBe(204);
    expect(await parts()).toEqual([]);
  });

  it("can be written by the Host for a holder without a phone, and the Host can change any part", async () => {
    const { host, gus, hal, send, pitch, parts } = await setup();
    await pitch(gus.cookie, "Grandma's recipe.");
    expect((await pitch(host, "It's vintage", { playerId: "cat" })).status).toBe(403); // Cat doesn't hold it yet
    await send({ type: "OpenGift", playerId: hal.playerId, giftId: "socks", name: "Socks" });
    await send({ type: "Steal", playerId: "cat", giftId: "cake" }); // Cat, typed in by the Host, takes it

    expect((await pitch(host, "It's vintage", { playerId: "cat" })).status).toBe(204);
    expect((await pitch(host, "Grandma's recipe, tidied by the Host", { playerId: gus.playerId })).status).toBe(204);
    expect((await parts()).map((p) => `${p.author}: ${p.text}`)).toEqual(["Cat: It's vintage", "Gus: Grandma's recipe, tidied by the Host"]);
  });

  it("follows the Feed's rules: waits under Approval, not while Paused or muted, and a Host can hide it", async () => {
    const { app, id, host, gus, pitch, parts } = await setup();
    await app.request(`/api/games/${id}/moderation`, post({ mode: "approval" }, host));
    await pitch(gus.cookie, "Grandma's recipe.");
    expect(await parts()).toEqual([]); // others don't see it yet
    expect((await parts(gus.cookie))[0]).toMatchObject({ status: "pending" });
    const part = (await parts(host))[0]!;
    await app.request(`/api/games/${id}/posts/${part.id}/status`, post({ status: "visible" }, host));
    expect(await parts()).toHaveLength(1);
    await app.request(`/api/games/${id}/posts/${part.id}/status`, post({ status: "hidden" }, host));
    expect(await parts()).toEqual([]);
    await pitch(gus.cookie, "Grandma's recipe, again");
    expect((await parts(host))[0]).toMatchObject({ status: "hidden" }); // a hidden part stays hidden

    await app.request(`/api/games/${id}/moderation`, post({ mode: "paused" }, host));
    expect((await pitch(gus.cookie, "Paused?")).status).toBe(409);
  });

  it("stays with its Gift, and isn't written once the Game is over", async () => {
    const { app, id, gus, send, pitch, parts } = await setup();
    await pitch(gus.cookie, "Grandma's recipe.");
    const part = (await parts())[0]!;
    expect((await app.request(`/api/games/${id}/posts/${part.id}/gift`, post({ giftId: null }, gus.cookie))).status).toBe(409);

    await send({ type: "EndGame" });
    expect((await pitch(gus.cookie, "One more thing")).status).toBe(409);
  });

  it("is up to 500 characters a part", async () => {
    const { gus, pitch } = await setup();
    expect((await pitch(gus.cookie, "x".repeat(501))).status).toBe(400);
    expect((await pitch(gus.cookie, "x".repeat(500))).status).toBe(204);
  });
});

describe("A pitch's headline and Photo", () => {
  it("has an optional tagline shown above the words, up to 80 characters, and may be just a tagline", async () => {
    const { gus, pitch, parts } = await setup();
    expect((await pitch(gus.cookie, "Grandma's recipe.", { tagline: "A TRUE HEIRLOOM" })).status).toBe(204);
    expect((await parts())[0]).toMatchObject({ tagline: "A TRUE HEIRLOOM", text: "Grandma's recipe." });
    expect((await pitch(gus.cookie, "", { tagline: "x".repeat(81) })).status).toBe(400);
    expect((await pitch(gus.cookie, "", { tagline: "Just a headline" })).status).toBe(204);
    expect((await parts())[0]).toMatchObject({ tagline: "Just a headline", text: "" });
  });

  it("may have a Photo, sent with the words, and taken off again", async () => {
    const { app, id, gus, parts } = await setup();
    const form = new FormData();
    form.append("tagline", "Look at it");
    form.append("photo", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "photo.jpg");
    expect((await app.request(`/api/games/${id}/gifts/cake/pitch`, { method: "PUT", body: form, headers: { cookie: gus.cookie } })).status).toBe(204);
    const part = (await parts())[0]!;
    expect(part.photo).not.toBeNull();
    expect((await app.request(part.photo!.url)).status).toBe(200);

    await app.request(`/api/games/${id}/gifts/cake/pitch`, put({ tagline: "Look at it", removePhoto: true }, gus.cookie));
    expect((await parts())[0]!.photo).toBeNull();
  });
});

describe("Pitching it again", () => {
  it("sends the holder's pitch back to the top of the Feed, no more often than every 5 minutes", async () => {
    const { app, id, gus, pitch, again, feed, minutes } = await setup();
    await pitch(gus.cookie, "Grandma's recipe.");
    minutes(1);
    await app.request(`/api/games/${id}/posts`, post({ text: "Hal's face!" }, gus.cookie));
    expect(await feed()).toEqual(["Hal's face!", "Grandma's recipe."]);

    expect((await again(gus.cookie)).status).toBe(429); // a minute after writing it
    minutes(4);
    expect((await again(gus.cookie)).status).toBe(204);
    expect(await feed()).toEqual(["Grandma's recipe.", "Hal's face!"]);
    minutes(2);
    const res = await again(gus.cookie);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "TooSoon", wait: 180 });
  });

  it("waits as long as the Host sets, or not at all at 0; the Host and Co-hosts never wait", async () => {
    const { app, id, host, gus, pitch, again } = await setup();
    await pitch(gus.cookie, "Grandma's recipe.");
    expect((await again(host, { playerId: gus.playerId })).status).toBe(204);
    await app.request(`/api/games/${id}/options`, { ...post({ repitchMinutes: 0 }, host), method: "PATCH" });
    expect((await again(gus.cookie)).status).toBe(204);
    expect((await again(gus.cookie)).status).toBe(204);
  });

  it("is only for the Gift's current holder, and only once the pitch is visible", async () => {
    const { app, id, host, gus, hal, send, pitch, again, minutes } = await setup();
    await app.request(`/api/games/${id}/moderation`, post({ mode: "approval" }, host));
    await pitch(gus.cookie, "Grandma's recipe.");
    minutes(10);
    expect((await again(gus.cookie)).status).toBe(404); // still waiting for approval
    await app.request(`/api/games/${id}/moderation`, post({ mode: "open" }, host));
    await send({ type: "Steal", playerId: hal.playerId, giftId: "cake" });
    expect((await again(gus.cookie)).status).toBe(404); // and Gus no longer holds it anyway
  });
});

describe("Flooding the Feed", () => {
  it("allows a guest 3 Posts a minute, then asks them to wait; the Host is never held back", async () => {
    const { app, id, host, gus, minutes } = await setup();
    const write = (cookie: string, text: string) => app.request(`/api/games/${id}/posts`, post({ text, name: "Host" }, cookie));
    for (let i = 0; i < 3; i++) expect((await write(gus.cookie, `Post ${i}`)).status).toBe(201);
    const res = await write(gus.cookie, "One more");
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "TooSoon", wait: 60 });
    for (let i = 0; i < 7; i++) expect((await write(host, `Host ${i}`)).status).toBe(201);
    minutes(1);
    expect((await write(gus.cookie, "One more")).status).toBe(201);
  });

  it("takes the Host's own limit, or none at 0", async () => {
    const { app, id, host, gus } = await setup();
    await app.request(`/api/games/${id}/options`, { ...post({ postsPerMinute: 2 }, host), method: "PATCH" });
    const write = (text: string) => app.request(`/api/games/${id}/posts`, post({ text }, gus.cookie));
    expect([(await write("a")).status, (await write("b")).status, (await write("c")).status]).toEqual([201, 201, 429]);
    await app.request(`/api/games/${id}/options`, { ...post({ postsPerMinute: 0 }, host), method: "PATCH" });
    expect((await write("d")).status).toBe(201);
  });
});
