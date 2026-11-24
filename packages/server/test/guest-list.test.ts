import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, hostGame, post, signIn } from "./support.js";

const put = (body: unknown, cookie?: string) => ({ ...post(body, cookie), method: "PUT" });
type Shown = { players: { id: string; name: string }[]; me: { playerId: string } | null };

async function setup() {
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer });
  const { id, cookie: host } = await hostGame(app, sent);
  const game = async (cookie?: string) => (await (await app.request(`/api/games/${id}`, cookie ? { headers: { cookie } } : {})).json()) as Shown;
  const list = async (cookie = host) => app.request(`/api/games/${id}/guest-list`, { headers: { cookie } });
  const add = (name: string, email: string, cookie = host) => app.request(`/api/games/${id}/guest-list`, post({ name, email }, cookie));
  const setEmail = (playerId: string, email: string | null, cookie = host) => app.request(`/api/games/${id}/players/${playerId}/email`, put({ email }, cookie));
  return { app, sent, id, host, game, list, add, setEmail, signedIn: (email: string) => signIn(app, sent, email) };
}

describe("The guest list (Players with emails)", () => {
  it("makes whoever signs in with a Player's email that Player, in a Host-entered Game", async () => {
    const { add, game, signedIn } = await setup();
    const res = await add("Ann Lee", "Ann@Corp.example");
    expect(res.status).toBe(200);
    const { playerId } = (await res.json()) as { playerId: string };

    const ann = await signedIn("ann@corp.example"); // the email is matched without regard to case
    expect((await game(ann)).me).toEqual({ playerId });
    expect((await game(await signedIn("bob@corp.example"))).me).toBeNull();
  });

  it("shows the Host each email and whether that person has opened the Game yet; guests can't see it", async () => {
    const { add, list, game, signedIn } = await setup();
    await add("Ann", "ann@corp.example");
    await add("Bob", "bob@corp.example");
    await game(await signedIn("ann@corp.example"));

    const shown = (await (await list()).json()) as { players: { email: string; joined: boolean }[] };
    expect(shown.players.map(({ email, joined }) => [email, joined])).toEqual([
      ["ann@corp.example", true],
      ["bob@corp.example", false],
    ]);
    expect((await list(await signedIn("bob@corp.example"))).status).toBe(403);
    expect(JSON.stringify(await game())).not.toContain("corp.example");
  });

  it("lets the Host give a typed-in Player an email, change it, or take it off", async () => {
    const { app, id, host, setEmail, game, signedIn } = await setup();
    await app.request(`/api/games/${id}/commands`, post({ type: "AddPlayer", playerId: "cat", name: "Cat" }, host));
    const cat = await signedIn("cat@corp.example");
    expect((await game(cat)).me).toBeNull();

    expect((await setEmail("cat", "cat@corp.example")).status).toBe(204);
    expect((await game(cat)).me).toEqual({ playerId: "cat" });

    expect((await setEmail("cat", "cathy@corp.example")).status).toBe(204);
    expect((await game(cat)).me).toBeNull();
    expect((await game(await signedIn("cathy@corp.example"))).me).toEqual({ playerId: "cat" });

    expect((await setEmail("cat", null)).status).toBe(204);
    expect((await game(await signedIn("cathy@corp.example"))).me).toBeNull();
  });

  it("refuses an email that's already another Player's, and a Player who isn't on the Roster", async () => {
    const { add, setEmail } = await setup();
    await add("Ann", "ann@corp.example");
    const bob = (await (await add("Bob", "bob@corp.example")).json()) as { playerId: string };

    const again = await add("Annie", "ann@corp.example");
    expect(again.status).toBe(409);
    expect(((await again.json()) as { message: string }).message).toMatch(/already Ann's/);
    expect((await setEmail(bob.playerId, "ann@corp.example")).status).toBe(409);
    expect((await setEmail("nobody", "x@corp.example")).status).toBe(404);
  });

  it("is only for the Host and Co-hosts", async () => {
    const { add, setEmail, signedIn } = await setup();
    const eve = await signedIn("eve@corp.example");
    expect((await add("Eve", "eve@corp.example", eve)).status).toBe(403);
    expect((await setEmail("x", "eve@corp.example", eve)).status).toBe(403);
  });

  it("means someone on the list can't join a second time in a Self sign-up Game", async () => {
    const { app, id, host, add, signedIn } = await setup();
    await app.request(`/api/games/${id}/options`, { ...post({ rosterMode: "self" }, host), method: "PATCH" });
    await add("Ann", "ann@corp.example");
    const ann = await signedIn("ann@corp.example");
    expect((await app.request(`/api/games/${id}/join`, post({ name: "Ann again" }, ann))).status).toBe(409);
  });
});
