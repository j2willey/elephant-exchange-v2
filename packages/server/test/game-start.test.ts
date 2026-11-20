import { describe, expect, it } from "vitest";
import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

type Setup = {
  choices: { choice: string; games: number; looked: number }[];
  options: { option: string; recommended: string; atStart: { value: string; games: number }[]; atEnd: { value: string; games: number }[]; changedLater: number }[];
  timer: { seconds: number; games: number; turns: number; averageTurnSeconds: number | null; overTimerShare: number | null }[];
};
type Session = { myOptions: Record<string, unknown> | null; alwaysMyOptions: boolean };

const mine = { activeSlots: 2, maxSteals: 2, turnSeconds: 120, rosterMode: "self", approveNames: true, moderation: "approval" } as const;
/** The body New Game sends: the rules apart, as the server has always taken them. */
const body = (o: typeof mine | typeof RECOMMENDED_OPTIONS, extra: Record<string, unknown> = {}) => {
  const { activeSlots, maxSteals, ...rest } = o;
  return { settings: { activeSlots, maxSteals }, ...rest, ...extra };
};

async function setup() {
  let ms = Date.UTC(2026, 11, 13, 19, 0, 0);
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer, now: () => new Date(ms), adminEmails: ["boss@willey.test"], draw: (w) => w[0]! });
  const as = (email: string) => signIn(app, sent, email);
  const admin = await as("boss@willey.test");
  const minutes = (n: number) => (ms += n * 60_000);
  const send = (id: string, cookie: string, cmd: unknown) => app.request(`/api/games/${id}/commands`, post(cmd, cookie));
  const create = async (cookie: string, b: Record<string, unknown>) => {
    const res = await app.request("/api/games", post(b, cookie));
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  const session = async (cookie: string) => (await (await app.request("/api/session", { headers: { cookie } })).json()) as Session;
  const game = async (id: string, cookie: string) =>
    (await (await app.request(`/api/games/${id}`, { headers: { cookie } })).json()) as {
      active: string[];
      settings: { activeSlots: number; maxSteals: number };
      clock: { turnSeconds: number };
      rosterMode: string;
      approveNames: boolean;
      moderation: string;
    };
  const setupStats = async () =>
    ((await (await app.request("/api/admin/stats", { headers: { cookie: admin } })).json()) as { insights: { setup: Setup } }).insights.setup;

  /** Four Players each open a Gift: the first after a day's wait, then 1 minute, a 45-minute break, 1 minute. */
  async function play(id: string, cookie: string) {
    for (let i = 0; i < 4; i++) await send(id, cookie, { type: "AddPlayer", playerId: `p${i}`, name: `P${i}` });
    await send(id, cookie, { type: "StartGame" });
    minutes(24 * 60);
    for (let i = 0; i < 4; i++) {
      if (i > 0) minutes(i === 2 ? 45 : 1);
      await send(id, cookie, { type: "OpenGift", playerId: (await game(id, cookie)).active[0], giftId: `g${i}`, name: `Gift ${i}` });
    }
    await send(id, cookie, { type: "EndGame" });
  }
  return { app, as, create, session, game, setupStats, play, send };
}

describe("Starting a Game with recommended or saved options", () => {
  it("creates the Game with every option chosen, including approving names and the Feed's posting rule", async () => {
    const { as, create, game } = await setup();
    const ann = await as("ann@willey.test");
    const id = await create(ann, body(mine, { start: "customized", looked: true }));

    expect(await game(id, ann)).toMatchObject({
      settings: { activeSlots: 2, maxSteals: 2 },
      clock: { turnSeconds: 120 },
      rosterMode: "self",
      approveNames: true,
      moderation: "approval",
    });
  });

  it("saves the whole set to the Host's account with \"Always start with these settings\", and stops on unticking it", async () => {
    const { as, create, session } = await setup();
    const ann = await as("ann@willey.test");
    expect(await session(ann)).toMatchObject({ myOptions: null, alwaysMyOptions: false });

    await create(ann, body(mine, { start: "customized", looked: true, remember: true }));
    expect(await session(ann)).toEqual(expect.objectContaining({ myOptions: mine, alwaysMyOptions: true }));

    // Not ticked this time: they're no longer used straight away, but kept to start from.
    await create(ann, body({ ...mine, turnSeconds: 0 }, { start: "customized", looked: true, remember: false }));
    expect(await session(ann)).toEqual(expect.objectContaining({ myOptions: mine, alwaysMyOptions: false }));
  });

  it("keeps each Host's saved options to themselves", async () => {
    const { as, create, session } = await setup();
    await create(await as("ann@willey.test"), body(mine, { start: "customized", remember: true }));
    expect(await session(await as("bob@willey.test"))).toMatchObject({ myOptions: null, alwaysMyOptions: false });
  });
});

describe("Statistics on how Games are started", () => {
  it("count Games by how the options were chosen, and who looked at the full list first", async () => {
    const { as, create, setupStats } = await setup();
    const ann = await as("ann@willey.test");
    await create(ann, body(RECOMMENDED_OPTIONS, { start: "recommended" }));
    await create(ann, body(RECOMMENDED_OPTIONS, { start: "recommended", looked: true })); // looked, changed nothing
    await create(ann, body(mine, { start: "customized", looked: true, remember: true }));
    await create(ann, body(mine, { start: "saved" }));
    await create(ann, body(mine, { start: "saved" }));
    await create(await as("smoke@example.com"), body(mine, { start: "customized" })); // a test address: left out

    expect((await setupStats()).choices).toEqual([
      { choice: "recommended", games: 2, looked: 1 },
      { choice: "customized", games: 1, looked: 1 },
      { choice: "saved", games: 2, looked: 0 },
      { choice: "unknown", games: 0, looked: 0 },
    ]);
  });

  it("show the values each option was set to, against the recommended one", async () => {
    const { as, create, setupStats } = await setup();
    const ann = await as("ann@willey.test");
    await create(ann, body(RECOMMENDED_OPTIONS, { start: "recommended" }));
    await create(ann, body(mine, { start: "customized" }));
    await create(ann, body({ ...mine, turnSeconds: 0 }, { start: "customized" }));

    const timer = (await setupStats()).options.find((o) => o.option === "turnSeconds")!;
    expect(timer.recommended).toBe("60");
    expect(timer.atStart).toEqual(expect.arrayContaining([{ value: "60", games: 1 }, { value: "120", games: 1 }, { value: "0", games: 1 }]));
  });

  it("count options changed after the Game was created, and what played Games ended up with", async () => {
    const { app, as, create, setupStats, play, send } = await setup();
    const ann = await as("ann@willey.test");
    const id = await create(ann, body(RECOMMENDED_OPTIONS, { start: "recommended" }));
    await app.request(`/api/games/${id}/options`, { ...post({ turnSeconds: 0, rosterMode: "host" }, ann), method: "PATCH" }); // rosterMode unchanged
    await send(id, ann, { type: "ChangeSettings", settings: { activeSlots: 2 } });
    await app.request(`/api/games/${id}/moderation`, post({ mode: "approval" }, ann));
    await play(id, ann);

    const { options } = await setupStats();
    const changed = Object.fromEntries(options.map((o) => [o.option, o.changedLater]));
    expect(changed).toEqual({ activeSlots: 1, maxSteals: 0, turnSeconds: 1, rosterMode: 0, approveNames: 0, moderation: 1 });
    expect(options.find((o) => o.option === "turnSeconds")!.atEnd).toEqual([{ value: "0", games: 1 }]);
    expect(options.find((o) => o.option === "activeSlots")!.atEnd).toEqual([{ value: "2", games: 1 }]);
  });

  it("show how long Turns really take against the timer, leaving out breaks", async () => {
    const { as, create, setupStats, play } = await setup();
    const ann = await as("ann@willey.test");
    await play(await create(ann, body({ ...RECOMMENDED_OPTIONS, turnSeconds: 30 }, { start: "customized" })), ann);
    await play(await create(ann, body({ ...RECOMMENDED_OPTIONS, turnSeconds: 90 }, { start: "customized" })), ann);

    // Each party has two 1-minute Turns; the day-long wait and the 45-minute break don't count.
    expect((await setupStats()).timer).toEqual([
      { seconds: 30, games: 1, turns: 2, averageTurnSeconds: 60, overTimerShare: 100 },
      { seconds: 90, games: 1, turns: 2, averageTurnSeconds: 60, overTimerShare: 0 },
    ]);
  });

  it("time a stolen-from Player's Turn from the Steal", async () => {
    const { as, create, setupStats, send, game } = await setup();
    const ann = await as("ann@willey.test");
    const id = await create(ann, body(RECOMMENDED_OPTIONS, { start: "recommended" }));
    for (let i = 0; i < 4; i++) await send(id, ann, { type: "AddPlayer", playerId: `p${i}`, name: `P${i}` });
    await send(id, ann, { type: "StartGame" });
    const up = async () => (await game(id, ann)).active[0];
    // Turns can't be timed by the clock here (it's fixed), so all take 0 s: what matters is how many are counted.
    await send(id, ann, { type: "OpenGift", playerId: await up(), giftId: "g0", name: "Mug" });
    await send(id, ann, { type: "OpenGift", playerId: await up(), giftId: "g1", name: "Socks" });
    await send(id, ann, { type: "Steal", playerId: await up(), giftId: "g0" }); // P2 steals from P0
    await send(id, ann, { type: "OpenGift", playerId: await up(), giftId: "g2", name: "Book" }); // P0 again
    await send(id, ann, { type: "OpenGift", playerId: await up(), giftId: "g3", name: "Pen" });

    expect((await setupStats()).timer).toEqual([{ seconds: 60, games: 1, turns: 5, averageTurnSeconds: 0, overTimerShare: 0 }]);
  });
});
