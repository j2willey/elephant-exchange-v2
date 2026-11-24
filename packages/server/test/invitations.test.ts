import { describe, expect, it } from "vitest";
import { invitationEmail } from "../src/mailer.js";
import { createServer } from "../src/server.js";
import { capturingMailer, hostGame, post, signIn } from "./support.js";

type Shown = { me: { playerId: string } | null };

async function setup(limits?: { perDay: number }) {
  const { sent, invited, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer, ...(limits ? { limits: { perEmail: 3, perIp: 120, ...limits } } : {}) });
  const { id, cookie: host } = await hostGame(app, sent);
  await app.request(`/api/games/${id}/options`, { ...post({ name: "Office swap", whenWhere: "Fri 10 am · Room B" }, host), method: "PATCH" });
  const add = async (name: string, email: string) =>
    ((await (await app.request(`/api/games/${id}/guest-list`, post({ name, email }, host))).json()) as { playerId: string }).playerId;
  const invite = async (playerIds?: string[], cookie = host) => app.request(`/api/games/${id}/invitations`, post(playerIds ? { playerIds } : {}, cookie));
  const tokenOf = (email: string) => new URL(invited.filter((i) => i.email === email).at(-1)!.url).searchParams.get("token")!;
  const open = (token: string) => app.request("/api/auth/invitation", post({ token }));
  const cookieOf = (res: Response) => res.headers.get("set-cookie")!.split(";")[0]!;
  const me = async (cookie: string) => ((await (await app.request(`/api/games/${id}`, { headers: { cookie } })).json()) as Shown).me;
  const guestList = async () =>
    ((await (await app.request(`/api/games/${id}/guest-list`, { headers: { cookie: host } })).json()) as { players: { email: string; invitedAt: number | null }[] }).players;
  return { app, sent, invited, id, host, add, invite, tokenOf, open, cookieOf, me, guestList };
}

describe("Personal invitations", () => {
  it("email everyone on the guest list who isn't in or invited yet, with the Game's name and When & where", async () => {
    const { add, invite, invited, guestList } = await setup();
    await add("Ann Lee", "ann@corp.example");
    await add("Bob", "bob@corp.example");

    const res = await invite();
    expect(await res.json()).toMatchObject({ sent: expect.any(Array), notSent: [] });
    expect(invited.map(({ email, name, gameName, whenWhere }) => [email, name, gameName, whenWhere])).toEqual([
      ["ann@corp.example", "Ann Lee", "Office swap", "Fri 10 am · Room B"],
      ["bob@corp.example", "Bob", "Office swap", "Fri 10 am · Room B"],
    ]);
    expect((await guestList()).every((g) => typeof g.invitedAt === "number")).toBe(true);

    await invite(); // nobody left to invite
    expect(invited).toHaveLength(2);
  });

  it("sign their person in once, as their Player, and take them to the Game", async () => {
    const { add, invite, tokenOf, open, cookieOf, me, id } = await setup();
    const ann = await add("Ann", "ann@corp.example");
    await invite();

    const first = await open(tokenOf("ann@corp.example"));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ email: "ann@corp.example", gameId: id });
    expect(await me(cookieOf(first))).toEqual({ playerId: ann });

    // Opened again (another device, or forwarded): nobody is signed in, and it says whose it was.
    const again = await open(tokenOf("ann@corp.example"));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ refused: "used", gameId: id, hint: "an…@corp.example" });
    expect(again.headers.get("set-cookie")).toBeNull();
  });

  it("offer a sign-in link to the invited address once used, which brings them back to the Game", async () => {
    const { app, add, invite, tokenOf, open, sent, id } = await setup();
    await add("Ann", "ann@corp.example");
    await invite();
    const token = tokenOf("ann@corp.example");
    await open(token);

    const res = await app.request("/api/auth/invitation/link", post({ token }));
    expect(res.status).toBe(202);
    const link = new URL(sent.filter((m) => m.email === "ann@corp.example").at(-1)!.url);
    expect(link.searchParams.get("next")).toBe(`/games/${id}`);
  });

  it("are replaced by a newer one, and stop working once the Game ends or they're off the guest list", async () => {
    const { app, add, invite, tokenOf, open, id, host } = await setup();
    const ann = await add("Ann", "ann@corp.example");
    await add("Bob", "bob@corp.example");
    await invite();
    const old = tokenOf("ann@corp.example");
    await invite([ann]);
    expect((await open(old)).status).toBe(401);

    await app.request(`/api/games/${id}/players/${ann}/email`, { ...post({ email: null }, host), method: "PUT" });
    expect((await open(tokenOf("ann@corp.example"))).status).toBe(401);

    await app.request(`/api/games/${id}/commands`, post({ type: "EndGame" }, host));
    expect((await open(tokenOf("bob@corp.example"))).status).toBe(401);
    expect((await invite()).status).toBe(409);
  });

  it("never sign in a Host or Co-host, whose role needs a sign-in link", async () => {
    const { app, add, invite, tokenOf, open, id, host } = await setup();
    const cat = await add("Cat", "cat@corp.example");
    await add("Dan", "dan@corp.example");
    await invite();
    await app.request(`/api/games/${id}/cohosts`, post({ email: "dan@corp.example" }, host));

    const res = await open(tokenOf("dan@corp.example"));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ refused: "staff" });
    expect(res.headers.get("set-cookie")).toBeNull();

    // Nor is one sent to a Co-host.
    await app.request(`/api/games/${id}/cohosts`, post({ email: "cat@corp.example" }, host));
    expect(await (await invite([cat])).json()).toEqual({ sent: [], notSent: [{ playerId: cat, reason: "Hosts and Co-hosts sign in with a link" }] });
  });

  it("share the day's email quota with sign-in links", async () => {
    const { add, invite } = await setup({ perDay: 3 }); // the Host's sign-in took one
    const players = [await add("Ann", "ann@corp.example"), await add("Bob", "bob@corp.example"), await add("Cat", "cat@corp.example")];
    const res = (await (await invite()).json()) as { sent: string[]; notSent: { playerId: string; reason: string }[] };
    expect(res.sent).toEqual(players.slice(0, 2));
    expect(res.notSent).toEqual([{ playerId: players[2], reason: "That's all the emails the app can send today" }]);
  });

  it("are sent only by the Host and Co-hosts", async () => {
    const { app, sent, invite } = await setup();
    expect((await invite(undefined, await signIn(app, sent, "eve@corp.example"))).status).toBe(403);
  });

  it("keep phones optional, and say not to forward the link", () => {
    const { subject, text } = invitationEmail({ gameName: "Office swap", tagline: "", whenWhere: "Fri 10 am", name: "Ann", url: "https://x/invite?token=t" });
    expect(subject).toBe("You're invited: Office swap");
    expect(text).toContain("Fri 10 am");
    expect(text).toContain("if you like");
    expect(text).toContain("don't forward it");
    expect(text).not.toMatch(/need|must|required/i);
  });
});
