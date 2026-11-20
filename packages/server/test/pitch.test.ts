import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

type Part = { id: string; author: string; giftId: string | null; text: string; status: string; pitchFor: string | null };
const put = (body: unknown, cookie: string) => ({ ...post(body, cookie), method: "PUT" });

/**
 * Gus and Hal join on their phones, Cat is typed in by the Host. Gus opens the Fruitcake; Hal is up next.
 * Players are drawn in the order they joined.
 */
async function setup() {
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer, draw: (w) => w[0]! });
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
  return { app, id, host, gus, hal, as, send, pitch, parts };
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
