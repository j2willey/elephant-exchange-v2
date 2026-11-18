import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

const del = (cookie?: string) => ({ method: "DELETE", headers: cookie ? { cookie } : {} });

async function setup() {
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer });
  const as = (email: string) => signIn(app, sent, email);
  const json = async <T>(path: string, cookie: string) => (await (await app.request(path, { headers: { cookie } })).json()) as T;
  const newGame = async (cookie: string, extra: Record<string, unknown> = {}) =>
    ((await (await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 }, ...extra }, cookie))).json()) as { id: string }).id;
  const newOrg = async (cookie: string, name: string) => ((await (await app.request("/api/orgs", post({ name }, cookie))).json()) as { id: string }).id;
  return { app, as, json, newGame, newOrg };
}

describe("A Host deleting their own Game", () => {
  it("deletes it and everything in it, so it's gone from their list and its link", async () => {
    const { app, as, json, newGame } = await setup();
    const ann = await as("ann@willey.test");
    const id = await newGame(ann, { name: "Party" });
    await app.request(`/api/games/${id}/commands`, post({ type: "AddPlayer", playerId: "bob", name: "Bob" }, ann));

    expect((await app.request(`/api/games/${id}`, del(ann))).status).toBe(204);

    expect((await app.request(`/api/games/${id}`, { headers: { cookie: ann } })).status).toBe(404);
    expect(await json<unknown[]>("/api/games", ann)).toEqual([]);
  });

  it("is the Host's alone: not a Co-host's, not anyone else's, not signed out", async () => {
    const { app, as, newGame } = await setup();
    const ann = await as("ann@willey.test");
    const id = await newGame(ann, { name: "Party" });
    await app.request(`/api/games/${id}/cohosts`, post({ email: "cat@willey.test" }, ann));

    expect((await app.request(`/api/games/${id}`, del(await as("cat@willey.test")))).status).toBe(403);
    expect((await app.request(`/api/games/${id}`, del(await as("dan@willey.test")))).status).toBe(403);
    expect((await app.request(`/api/games/${id}`, del())).status).toBe(401);
    expect((await app.request(`/api/games/${id}`, { headers: { cookie: ann } })).status).toBe(200);
    expect((await app.request("/api/games/nope", del(ann))).status).toBe(404);
  });
});

describe("An Organizer deleting their own Organization", () => {
  it("deletes it; a Game that used its look keeps going, in the app's own colors", async () => {
    const { app, as, json, newGame, newOrg } = await setup();
    const ann = await as("ann@willey.test");
    const lodge = await newOrg(ann, "Lodge 22");
    await app.request(`/api/orgs/${lodge}`, { method: "PATCH", headers: { "content-type": "application/json", cookie: ann }, body: JSON.stringify({ color: "#0b3d91" }) });
    const id = await newGame(ann, { name: "Party", orgId: lodge });
    expect((await json<{ theme: { organization: unknown; color: string | null } }>(`/api/games/${id}`, ann)).theme).toMatchObject({
      organization: { name: "Lodge 22" },
      color: "#0b3d91",
    });

    expect((await app.request(`/api/orgs/${lodge}`, del(ann))).status).toBe(204);

    expect(await json<unknown[]>("/api/orgs", ann)).toEqual([]);
    const game = await json<{ name: string; theme: { organization: unknown; color: string | null } }>(`/api/games/${id}`, ann);
    expect(game.name).toBe("Party");
    expect(game.theme).toMatchObject({ organization: null, color: null });
  });

  it("is the Organizer's alone", async () => {
    const { app, as, json, newOrg } = await setup();
    const ann = await as("ann@willey.test");
    const lodge = await newOrg(ann, "Lodge 22");

    expect((await app.request(`/api/orgs/${lodge}`, del(await as("bob@willey.test")))).status).toBe(403);
    expect((await app.request(`/api/orgs/${lodge}`, del())).status).toBe(401);
    expect((await app.request("/api/orgs/nope", del(ann))).status).toBe(404);
    expect(await json<unknown[]>("/api/orgs", ann)).toHaveLength(1);
  });
});
