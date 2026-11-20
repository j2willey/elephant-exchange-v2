import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

type Game = { role: string | null; me: { playerId: string } | null; myVote: string | null };
type Post = { author: string; mine: boolean };

/**
 * The demo page's sample phone is one of a demo Game's made-up Players. It's opened in the Host's own browser, so
 * it carries the Host's sign-in; the `x-demo-player` header says which Player it is.
 */
async function setup({ demo = true } = {}) {
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer, draw: (c) => c[0]! });
  const host = await signIn(app, sent, "host@example.com");
  const res = await app.request("/api/games", post({ name: "Demo game", demo, settings: { activeSlots: 1, maxSteals: 3 } }, host));
  const { id } = (await res.json()) as { id: string };
  const command = (cmd: unknown, headers: Record<string, string> = {}) =>
    app.request(`/api/games/${id}/commands`, { ...post(cmd, host), headers: { ...post(cmd, host).headers, ...headers } });
  for (const p of ["ann", "bob"]) await command({ type: "AddPlayer", playerId: p, name: p.toUpperCase() });
  const asAnn = { cookie: host, "x-demo-player": "ann" };
  const get = async (headers: Record<string, string>) => app.request(`/api/games/${id}`, { headers });
  return { app, sent, id, host, asAnn, command, get };
}

describe("A demo Game's sample phone", () => {
  it("is the made-up Player it names: no Host role, and that Player as `me`", async () => {
    const { get, asAnn, host } = await setup();
    const res = await get(asAnn);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: null, me: { playerId: "ann" } } satisfies Partial<Game>);
    // The Host's own console is unchanged.
    expect(await (await get({ cookie: host })).json()).toMatchObject({ role: "host", me: null });
  });

  it("can't run the Game", async () => {
    const { command, get, host } = await setup();
    const res = await command({ type: "StartGame" }, { "x-demo-player": "ann" });
    expect(res.status).toBe(403);
    expect(await (await get({ cookie: host })).json()).toMatchObject({ phase: "setup" });
  });

  it("posts as that Player", async () => {
    const { app, id, asAnn, host } = await setup();
    const res = await app.request(`/api/games/${id}/posts`, {
      method: "POST",
      headers: { ...asAnn, "content-type": "application/json" },
      body: JSON.stringify({ text: "Hi from Ann's phone", name: "Someone else" }),
    });
    expect(res.status).toBe(201);
    const mine = (await (await app.request(`/api/games/${id}/posts`, { headers: asAnn })).json()) as Post[];
    expect(mine).toEqual([expect.objectContaining({ author: "ANN", mine: true })]);
    const hosts = (await (await app.request(`/api/games/${id}/posts`, { headers: { cookie: host } })).json()) as Post[];
    expect(hosts).toEqual([expect.objectContaining({ author: "ANN", mine: false })]);
  });

  it("votes as that Player, apart from the Host", async () => {
    const { app, id, command, get, asAnn, host } = await setup();
    await command({ type: "StartGame" });
    await command({ type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });
    await command({ type: "OpenGift", playerId: "bob", giftId: "g2", name: "Mug" });
    await app.request(`/api/games/${id}/commands`, post({ type: "EndGame" }, host));
    await app.request(`/api/games/${id}/vote/status`, post({ status: "open" }, host));

    expect((await app.request(`/api/games/${id}/vote`, { ...post({ giftId: "g1" }), headers: { ...asAnn, "content-type": "application/json" } })).status).toBe(200);
    expect(await (await get(asAnn)).json()).toMatchObject({ myVote: "g1" });
    expect(await (await get({ cookie: host })).json()).toMatchObject({ myVote: null });
  });

  it("is refused outside a demo Game, to anyone but its Hosts, and for a Player who isn't there", async () => {
    const real = await setup({ demo: false });
    expect((await real.get(real.asAnn)).status).toBe(403);

    const { app, sent, get, host } = await setup();
    const stranger = await signIn(app, sent, "stranger@example.com");
    expect((await get({ cookie: stranger, "x-demo-player": "ann" })).status).toBe(403);
    expect((await get({ "x-demo-player": "ann" })).status).toBe(403);
    expect((await get({ cookie: host, "x-demo-player": "nobody" })).status).toBe(403);
  });
});

describe("A Game's view", () => {
  it("says whether it's a demo, so the Host console can offer its demo view", async () => {
    const { sent, mailer } = capturingMailer();
    const { app } = createServer({ dbPath: ":memory:", mailer });
    const cookie = await signIn(app, sent, "host@example.com");
    const make = async (demo: boolean) =>
      ((await (await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 }, demo }, cookie))).json()) as { id: string }).id;
    const shown = async (id: string) => ((await (await app.request(`/api/games/${id}`)).json()) as { demo: boolean }).demo;

    expect(await shown(await make(true))).toBe(true);
    expect(await shown(await make(false))).toBe(false);
  });
});

describe("A demo Game's made-up Players as people", () => {
  type Person = { key: string; name: string | null; hint: string; playerId: string | null; role: string | null };
  const people = async (app: { request: (p: string, i?: RequestInit) => Response | Promise<Response> }, id: string, host: string) =>
    ((await (await app.request(`/api/games/${id}/people`, { headers: { cookie: host } })).json()) as { people: Person[] }).people;

  it("each have a stand-in email at example.com, so the Host can find them in the Co-hosts panel", async () => {
    const { app, id, host } = await setup();
    const found = await people(app, id, host);
    expect(found.filter((p) => p.name).map((p) => [p.name, p.hint, p.playerId])).toEqual([
      ["ANN", "an…@example.com", "ann"],
      ["BOB", "bo…@example.com", "bob"],
    ]);
  });

  it("can be made a Co-host, and the sample phone as that Player then runs the Game", async () => {
    const { app, id, host, get, asAnn, command } = await setup();
    const ann = (await people(app, id, host)).find((p) => p.name === "ANN")!;
    expect((await app.request(`/api/games/${id}/people/${ann.key}`, post({ cohost: true }, host))).status).toBe(204);

    expect(await (await get(asAnn)).json()).toMatchObject({ role: "cohost", me: { playerId: "ann" } });
    expect((await command({ type: "StartGame" }, { "x-demo-player": "ann" })).status).toBe(200);
    const staff = (await (await app.request(`/api/games/${id}/staff`, { headers: { cookie: host } })).json()) as { staff: unknown[] };
    expect(staff.staff).toEqual([{ playerId: "ann", role: "cohost" }]);
  });

  it("get different stand-ins when two share a name", async () => {
    const { app, id, host, command } = await setup();
    await command({ type: "AddPlayer", playerId: "ann2", name: "Ann" });
    expect((await people(app, id, host)).map((p) => p.hint).filter((h) => h.startsWith("an"))).toEqual(["an…@example.com", "an…@example.com"]);
  });

  it("aren't given in a real Game: Players the Host types in there have no email", async () => {
    const { app, id, host } = await setup({ demo: false });
    expect((await people(app, id, host)).filter((p) => p.name)).toEqual([]);
  });
});
