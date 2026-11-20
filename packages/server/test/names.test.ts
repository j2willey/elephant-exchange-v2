import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

type Post = { id: string; author: string; mine: boolean };
type Game = { players: { id: string; name: string }[]; me: { playerId: string } | null; myName: { name: string | null; locked: boolean } | null };

/** A Self sign-up Game: Tess joined as a Player and posted, Gus posted as a Guest, and the Host typed in Pat. */
async function setup() {
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer });
  const host = await signIn(app, sent, "host@example.com");
  const { id } = (await (await app.request("/api/games", post({ rosterMode: "self", settings: { activeSlots: 1, maxSteals: 3 } }, host))).json()) as {
    id: string;
  };
  const as = (email: string) => signIn(app, sent, email);
  const tess = await as("tess@example.com");
  await app.request(`/api/games/${id}/join`, post({ name: "Tess" }, tess));
  await app.request(`/api/games/${id}/posts`, post({ text: "Hi from Tess" }, tess));
  const gus = await as("gus@example.com");
  await app.request(`/api/games/${id}/posts`, post({ text: "Hi from Gus", name: "Mr. Rude" }, gus));
  await app.request(`/api/games/${id}/commands`, post({ type: "AddPlayer", playerId: "pat", name: "Pat" }, host));
  const cohost = await as("cora@example.com");
  await app.request(`/api/games/${id}/cohosts`, post({ email: "cora@example.com" }, host));

  const game = async (cookie?: string) =>
    (await (await app.request(`/api/games/${id}`, cookie ? { headers: { cookie } } : {})).json()) as Game;
  const feed = async () => (await (await app.request(`/api/games/${id}/posts`)).json()) as Post[];
  const postBy = async (text: string) => (await feed()).find((p) => (p as unknown as { text: string }).text === text)!;
  const rename = (cookie: string, body: unknown) => app.request(`/api/games/${id}/names`, post(body, cookie));
  const nameOf = async (playerId: string) => (await game()).players.find((p) => p.id === playerId)!.name;
  const tessId = (await game(tess)).me!.playerId;
  return { app, id, host, tess, gus, cohost, as, game, feed, postBy, rename, nameOf, tessId };
}

describe("The Host or a Co-host renaming someone", () => {
  it("renames a Guest from one of their Posts, on every Post they've made", async () => {
    const { app, id, gus, cohost, rename, postBy, feed } = await setup();
    await app.request(`/api/games/${id}/posts`, post({ text: "Again", name: "Mr. Rude" }, gus));

    expect((await rename(cohost, { postId: (await postBy("Hi from Gus")).id, name: "Gus", locked: true })).status).toBe(204);

    expect((await feed()).filter((p) => p.author === "Mr. Rude")).toEqual([]);
    expect((await postBy("Again")).author).toBe("Gus");
  });

  it("renames a Player from the roster, and their Posts with them", async () => {
    const { host, tessId, rename, nameOf, postBy } = await setup();

    expect((await rename(host, { playerId: tessId, name: "Tessa", locked: true })).status).toBe(204);

    expect(await nameOf(tessId)).toBe("Tessa");
    expect((await postBy("Hi from Tess")).author).toBe("Tessa");
  });

  it("renames a Player the Host typed in, who has no Posts or account", async () => {
    const { host, rename, nameOf } = await setup();
    expect((await rename(host, { playerId: "pat", name: "Patrick", locked: false })).status).toBe(204);
    expect(await nameOf("pat")).toBe("Patrick");
  });

  it("renames a Player from one of their Posts", async () => {
    const { host, tessId, rename, nameOf, postBy } = await setup();
    await rename(host, { postId: (await postBy("Hi from Tess")).id, name: "Tessa", locked: true });
    expect(await nameOf(tessId)).toBe("Tessa");
  });

  it("is only for the Host and Co-hosts", async () => {
    const { gus, tessId, rename } = await setup();
    expect((await rename(gus, { playerId: tessId, name: "Loser", locked: true })).status).toBe(403);
  });

  it("refuses an empty name, or no one to rename", async () => {
    const { host, tessId, rename } = await setup();
    expect((await rename(host, { playerId: tessId, name: "  ", locked: true })).status).toBe(400);
    expect((await rename(host, { name: "Tessa", locked: true })).status).toBe(400);
    expect((await rename(host, { playerId: "nobody", name: "Tessa", locked: true })).status).toBe(404);
    expect((await rename(host, { postId: "nopost", name: "Tessa", locked: true })).status).toBe(404);
  });
});

describe("A locked name", () => {
  it("is what a Guest posts as from then on, whatever name they give", async () => {
    const { app, id, gus, host, rename, postBy, game } = await setup();
    await rename(host, { postId: (await postBy("Hi from Gus")).id, name: "Gus", locked: true });

    await app.request(`/api/games/${id}/posts`, post({ text: "Ha", name: "Mr. Rude Again" }, gus));

    expect((await postBy("Ha")).author).toBe("Gus");
    expect((await game(gus)).myName).toEqual({ name: "Gus", locked: true });
  });

  it("tells a Player their name is locked", async () => {
    const { tess, host, tessId, rename, game } = await setup();
    expect((await game(tess)).myName).toEqual({ name: "Tess", locked: false });
    await rename(host, { playerId: tessId, name: "Tessa", locked: true });
    expect((await game(tess)).myName).toEqual({ name: "Tessa", locked: true });
  });

  it("can be unlocked by the Host", async () => {
    const { gus, host, rename, postBy, game } = await setup();
    const postId = (await postBy("Hi from Gus")).id;
    await rename(host, { postId, name: "Gus", locked: true });
    await rename(host, { postId, name: "Gus", locked: false });
    expect((await game(gus)).myName).toEqual({ name: "Gus", locked: false });
  });
});

describe("A Guest's name", () => {
  it("is remembered for the Game, so a Guest who changes it is renamed on their earlier Posts too", async () => {
    const { app, id, gus, postBy, game } = await setup();
    expect((await game(gus)).myName).toEqual({ name: "Mr. Rude", locked: false });

    await app.request(`/api/games/${id}/posts`, post({ text: "Sorry", name: "Gus" }, gus));

    expect((await postBy("Hi from Gus")).author).toBe("Gus");
  });

  it("isn't needed again once given", async () => {
    const { app, id, gus, postBy } = await setup();
    expect((await app.request(`/api/games/${id}/posts`, post({ text: "No name" }, gus))).status).toBe(201);
    expect((await postBy("No name")).author).toBe("Mr. Rude");
  });

  it("is null for someone signed in who hasn't given one, and the whole thing for nobody signed in", async () => {
    const { as, game } = await setup();
    expect((await game(await as("new@example.com"))).myName).toEqual({ name: null, locked: false });
    expect((await game()).myName).toBeNull();
  });
});
