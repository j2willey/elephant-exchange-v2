import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, hostGame, post, signIn } from "./support.js";

type Shown = { players: { id: string; name: string }[]; me: { playerId: string } | null; asking: boolean; myName: { name: string | null } | null };

async function setup() {
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer });
  const { id, cookie: host } = await hostGame(app, sent); // Host-entered, as Games are unless the Host says
  const game = async (cookie: string) => (await (await app.request(`/api/games/${id}`, { headers: { cookie } })).json()) as Shown;
  const ask = (name: string, cookie: string) => app.request(`/api/games/${id}/ask-to-play`, post({ name }, cookie));
  const asking = async (cookie = host) => app.request(`/api/games/${id}/asking`, { headers: { cookie } });
  const listed = async () => ((await (await asking()).json()) as { asking: { key: string; name: string }[] }).asking;
  const answer = (key: string, add: boolean, cookie = host) => app.request(`/api/games/${id}/asking`, post({ key, add }, cookie));
  return { app, id, host, game, ask, asking, listed, answer, signedIn: (email: string) => signIn(app, sent, email) };
}

describe("Asking to play, in a Host-entered Game", () => {
  it("lets a Guest who brought a gift ask, and the Host add them as a Player with one tap", async () => {
    const { game, ask, listed, answer, signedIn } = await setup();
    const eve = await signedIn("eve@corp.example");
    expect((await ask("Eve", eve)).status).toBe(204);
    expect(await game(eve)).toMatchObject({ asking: true, me: null, myName: { name: "Eve" } });

    const [request] = await listed();
    expect(request).toMatchObject({ name: "Eve" });
    expect(JSON.stringify(await listed())).not.toContain("corp.example");

    expect((await answer(request!.key, true)).status).toBe(204);
    const now = await game(eve);
    expect(now.asking).toBe(false);
    expect(now.players.find((p) => p.id === now.me?.playerId)?.name).toBe("Eve");
    expect(await listed()).toEqual([]);
  });

  it("leaves them a Guest when the Host says they're not playing", async () => {
    const { game, ask, listed, answer, signedIn } = await setup();
    const eve = await signedIn("eve@corp.example");
    await ask("Eve", eve);
    await answer((await listed())[0]!.key, false);
    expect(await game(eve)).toMatchObject({ asking: false, me: null, players: [] });
  });

  it("can be taken back", async () => {
    const { app, id, game, ask, listed, signedIn } = await setup();
    const eve = await signedIn("eve@corp.example");
    await ask("Eve", eve);
    await app.request(`/api/games/${id}/ask-to-play`, { method: "DELETE", headers: { cookie: eve } });
    expect(await listed()).toEqual([]);
    expect((await game(eve)).asking).toBe(false);
  });

  it("isn't for a Self sign-up Game, someone already playing, or anyone not signed in", async () => {
    const { app, id, host, ask, signedIn } = await setup();
    const eve = await signedIn("eve@corp.example");
    await app.request(`/api/games/${id}/guest-list`, post({ name: "Eve", email: "eve@corp.example" }, host));
    expect((await ask("Eve", eve)).status).toBe(409);
    expect((await app.request(`/api/games/${id}/ask-to-play`, post({ name: "Zed" }))).status).toBe(401);

    await app.request(`/api/games/${id}/options`, { ...post({ rosterMode: "self" }, host), method: "PATCH" });
    expect((await ask("Fay", await signedIn("fay@corp.example"))).status).toBe(409);
  });

  it("is answered only by the Host and Co-hosts", async () => {
    const { asking, answer, signedIn } = await setup();
    const eve = await signedIn("eve@corp.example");
    expect((await asking(eve)).status).toBe(403);
    expect((await answer("x", true, eve)).status).toBe(403);
  });
});
