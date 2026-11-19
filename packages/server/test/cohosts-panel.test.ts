import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

type Person = { key: string; name: string | null; hint: string; playerId: string | null; role: "host" | "cohost" | null; you: boolean };

/** A Self sign-up Game in setup: Tess joined as a Player, Gus posted as a Guest, Vic only opened the Game. */
async function setup() {
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer });
  const host = await signIn(app, sent, "host@example.com");
  const { id } = (await (await app.request("/api/games", post({ rosterMode: "self", settings: { activeSlots: 1, maxSteals: 3 } }, host))).json()) as {
    id: string;
  };
  const as = (email: string) => signIn(app, sent, email);
  const tess = await as("tess.jones@example.com");
  await app.request(`/api/games/${id}/join`, post({ name: "Tess" }, tess));
  const gus = await as("gus@example.com");
  await app.request(`/api/games/${id}/posts`, post({ text: "Hi", name: "Gus" }, gus));
  const vic = await as("vic@example.com");
  await app.request(`/api/games/${id}`, { headers: { cookie: vic } });
  await app.request(`/api/games/${id}/commands`, post({ type: "AddPlayer", playerId: "pat", name: "Pat" }, host));

  const people = async (cookie: string) => app.request(`/api/games/${id}/people`, { headers: { cookie } });
  const list = async () => ((await (await people(host)).json()) as { people: Person[] }).people;
  const set = (cookie: string, key: string, body: unknown) => app.request(`/api/games/${id}/people/${key}`, post(body, cookie));
  const staff = async (cookie: string) =>
    ((await (await app.request(`/api/games/${id}/staff`, { headers: { cookie } })).json()) as { staff: { playerId: string; role: string }[] }).staff;
  const find = async (name: string) => (await list()).find((p) => p.name === name)!;
  return { app, id, host, tess, gus, vic, as, people, list, set, staff, find };
}

describe("The Co-hosts panel's people", () => {
  it("lists everyone known to the Game, by name, without their email", async () => {
    const { list } = await setup();
    const people = await list();

    expect(people.map((p) => [p.name, p.role, p.you])).toEqual([
      ["Gus", null, false],
      ["Tess", null, false],
      [null, "host", true],
      [null, null, false],
    ]);
    expect(people.map((p) => p.hint)).toEqual(["gu…@example.com", "te…@example.com", "ho…@example.com", "vi…@example.com"]);
    expect(JSON.stringify(people)).not.toMatch(/gus@|tess\.jones@|vic@|host@/);
    expect(people.find((p) => p.name === "Tess")!.playerId).toBeTruthy();
  });

  it("is only for the Host", async () => {
    const { people, set, tess, find } = await setup();
    expect((await people(tess)).status).toBe(403);
    expect((await set(tess, (await find("Gus")).key, { cohost: true })).status).toBe(403);
  });
});

describe("Switching Co-hosts on and off", () => {
  it("lets the Host switch a Co-host on and off by name", async () => {
    const { app, id, host, set, find, gus } = await setup();
    const key = (await find("Gus")).key;
    const run = (name: string) => app.request(`/api/games/${id}/commands`, post({ type: "AddPlayer", playerId: name, name }, gus));

    expect((await set(host, key, { cohost: true })).status).toBe(204);
    expect((await find("Gus")).role).toBe("cohost");
    expect((await run("one")).status).toBe(200);

    expect((await set(host, key, { cohost: false })).status).toBe(204);
    expect((await find("Gus")).role).toBeNull();
    expect((await run("two")).status).toBe(403);
  });

  it("never takes the Host off", async () => {
    const { host, set, list } = await setup();
    const me = (await list()).find((p) => p.you)!;
    expect((await set(host, me.key, { cohost: false })).status).toBe(400);
    expect((await list()).find((p) => p.you)!.role).toBe("host");
  });

  it("refuses someone the Game doesn't know", async () => {
    const { host, set } = await setup();
    expect((await set(host, "nobody", { cohost: true })).status).toBe(404);
  });
});

describe("Which Player a Host or Co-host plays as", () => {
  it("is known for a Co-host who joined as a Player, and shown to the Host and Co-hosts only", async () => {
    const { host, tess, gus, set, find, staff, app, id } = await setup();
    await set(host, (await find("Tess")).key, { cohost: true });
    const tessPlayer = (await find("Tess")).playerId!;

    expect(await staff(host)).toEqual([{ playerId: tessPlayer, role: "cohost" }]);
    expect(await staff(tess)).toEqual([{ playerId: tessPlayer, role: "cohost" }]);
    expect((await app.request(`/api/games/${id}/staff`, { headers: { cookie: gus } })).status).toBe(403);
  });

  it("can be set by the Host for a Player they typed in, the Host included", async () => {
    const { host, set, find, list, staff } = await setup();
    const me = (await list()).find((p) => p.you)!;
    const gus = (await find("Gus")).key;
    await set(host, gus, { cohost: true });

    expect((await set(host, me.key, { playsAs: "pat" })).status).toBe(204);
    expect((await set(host, gus, { playsAs: "nobody" })).status).toBe(400);
    expect(await staff(host)).toEqual([{ playerId: "pat", role: "host" }]);

    expect((await set(host, me.key, { playsAs: null })).status).toBe(204);
    expect(await staff(host)).toEqual([]);
  });

  it("can't be set for someone who isn't a Host or Co-host", async () => {
    const { host, set, find } = await setup();
    expect((await set(host, (await find("Gus")).key, { playsAs: "pat" })).status).toBe(400);
  });
});
