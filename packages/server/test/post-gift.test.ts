import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, scriptedDraw, signIn } from "./support.js";

/** A Game with a Mug opened, and Gus's Post about no Gift. */
async function setup() {
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer, draw: scriptedDraw(["ann", "bob"]) });
  const host = await signIn(app, sent, "host@example.com");
  const { id } = (await (await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 } }, host))).json()) as { id: string };
  const send = (cmd: unknown) => app.request(`/api/games/${id}/commands`, post(cmd, host));
  for (const name of ["ann", "bob"]) await send({ type: "AddPlayer", playerId: name, name });
  await send({ type: "StartGame" });
  await send({ type: "OpenGift", playerId: "ann", giftId: "g1", name: "Mug" });
  const as = (email: string) => signIn(app, sent, email);
  const gus = await as("gus@example.com");
  await app.request(`/api/games/${id}/posts`, post({ text: "Ann's face!", name: "Gus" }, gus));
  const read = async () => (await (await app.request(`/api/games/${id}/posts`)).json()) as { id: string; giftId: string | null }[];
  const postId = (await read())[0]!.id;
  const attach = (cookie: string, giftId: string | null, which = postId) => app.request(`/api/games/${id}/posts/${which}/gift`, post({ giftId }, cookie));
  return { app, id, host, gus, as, read, attach };
}

describe("Attaching a Post to a Gift after posting", () => {
  it("lets the poster attach their own Post, and take it off again", async () => {
    const { gus, attach, read } = await setup();
    expect((await attach(gus, "g1")).status).toBe(204);
    expect((await read())[0]!.giftId).toBe("g1");
    expect((await attach(gus, null)).status).toBe(204);
    expect((await read())[0]!.giftId).toBeNull();
  });

  it("lets the Host or a Co-host attach anyone's Post", async () => {
    const { host, attach, read } = await setup();
    expect((await attach(host, "g1")).status).toBe(204);
    expect((await read())[0]!.giftId).toBe("g1");
  });

  it("isn't for anyone else's Post", async () => {
    const { as, attach } = await setup();
    expect((await attach(await as("dot@example.com"), "g1")).status).toBe(403);
  });

  it("refuses a Gift that isn't opened, or a Post that isn't there", async () => {
    const { gus, host, attach } = await setup();
    expect((await attach(gus, "g9")).status).toBe(400);
    expect((await attach(host, "g1", "nopost")).status).toBe(404);
  });
});
