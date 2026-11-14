import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, scriptedDraw, signIn } from "./support.js";

type Vote = { status: "none" | "open" | "closed"; display: "live" | "hidden" | "parade"; cast: number; counts: Record<string, number> | null; winner: string | null };
type Game = { vote: Vote; myVote?: string | null; phase: string };

/** A finished Game: Ann holds Socks (g1), Bob the Mug (g2), Cat the Candle (g3). */
async function finished({ end = true } = {}) {
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer, draw: scriptedDraw(["ann", "bob", "cat"]) });
  const host = await signIn(app, sent, "host@example.com");
  const { id } = (await (await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 } }, host))).json()) as { id: string };
  const command = (cmd: unknown) => app.request(`/api/games/${id}/commands`, post(cmd, host));
  for (const p of ["ann", "bob", "cat"]) await command({ type: "AddPlayer", playerId: p, name: p.toUpperCase() });
  await command({ type: "StartGame" });
  await command({ type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });
  await command({ type: "OpenGift", playerId: "bob", giftId: "g2", name: "Mug" });
  await command({ type: "OpenGift", playerId: "cat", giftId: "g3", name: "Candle" });
  if (end) await command({ type: "EndGame" });

  const as = (email: string) => signIn(app, sent, email);
  const game = async (cookie?: string) => (await (await app.request(`/api/games/${id}`, cookie ? { headers: { cookie } } : {})).json()) as Game;
  const setStatus = (cookie: string, status: "open" | "closed", winner?: string) =>
    app.request(`/api/games/${id}/vote/status`, post(winner ? { status, winner } : { status }, cookie));
  const setDisplay = (cookie: string, display: string) => app.request(`/api/games/${id}/vote/display`, post({ display }, cookie));
  const vote = (cookie: string | undefined, giftId: string) => app.request(`/api/games/${id}/vote`, post({ giftId }, cookie));
  /** Several people, each casting one vote. */
  const votesFor = async (...giftIds: string[]) => {
    for (const [i, giftId] of giftIds.entries()) await vote(await as(`voter${i}@example.com`), giftId);
  };
  return { app, id, host, as, game, setStatus, setDisplay, vote, votesFor };
}

describe("The Worst Gift Vote", () => {
  it("opens only once the Game has ended, and only by the Host or a Co-host", async () => {
    const early = await finished({ end: false });
    expect((await early.setStatus(early.host, "open")).status).toBe(409);

    const { host, as, setStatus, game } = await finished();
    expect((await game()).vote).toMatchObject({ status: "none" });
    expect((await setStatus(await as("gus@example.com"), "open")).status).toBe(403);
    expect((await setStatus(host, "open")).status).toBe(204);
    expect((await game()).vote).toMatchObject({ status: "open", display: "live", cast: 0 });
  });

  it("gives everyone signed in one vote, which they can move, even to the Gift they hold", async () => {
    const { host, as, setStatus, vote, game } = await finished();
    const gus = await as("gus@example.com");
    expect((await vote(gus, "g2")).status).toBe(409); // not open yet
    await setStatus(host, "open");

    expect((await vote(undefined, "g2")).status).toBe(401);
    expect((await vote(gus, "nope")).status).toBe(400);
    expect((await vote(gus, "g2")).status).toBe(200);
    expect((await vote(gus, "g3")).status).toBe(200); // moved
    expect((await vote(host, "g3")).status).toBe(200); // Hosts vote too

    expect((await game(gus)).myVote).toBe("g3");
    expect((await game()).vote).toMatchObject({ cast: 2, counts: { g3: 2 } });
  });

  it("shows nobody the counts under Hidden or Parade until the vote closes, though everyone sees how many have voted", async () => {
    const { host, setStatus, setDisplay, votesFor, game } = await finished();
    await setStatus(host, "open");
    expect((await setDisplay(host, "hidden")).status).toBe(204);
    await votesFor("g1", "g1", "g2");

    expect((await game()).vote).toMatchObject({ display: "hidden", cast: 3, counts: null });
    expect((await game(host)).vote.counts).toBeNull(); // not even the Host
    await setDisplay(host, "parade");
    expect((await game()).vote).toMatchObject({ display: "parade", counts: null });
    await setDisplay(host, "live");
    expect((await game()).vote.counts).toEqual({ g1: 2, g2: 1 });
    await setDisplay(host, "hidden");

    await setStatus(host, "closed");
    expect((await game()).vote).toMatchObject({ status: "closed", counts: { g1: 2, g2: 1 }, winner: "g1" });
  });

  it("asks the Host to pick among Gifts tied for most, and takes only one of those", async () => {
    const { host, setStatus, votesFor, game } = await finished();
    await setStatus(host, "open");
    await votesFor("g1", "g2", "g1", "g2", "g3");

    const tie = await setStatus(host, "closed");
    expect(tie.status).toBe(409);
    expect(await tie.json()).toMatchObject({ code: "Tie", tied: ["g1", "g2"] });
    expect((await game()).vote.status).toBe("open");
    expect((await setStatus(host, "closed", "g3")).status).toBe(400);

    expect((await setStatus(host, "closed", "g2")).status).toBe(204);
    expect((await game()).vote).toMatchObject({ status: "closed", winner: "g2" });
  });

  it("stops taking votes once closed, and can be opened again if closed by mistake", async () => {
    const { host, as, setStatus, vote, votesFor, game } = await finished();
    await setStatus(host, "open");
    await votesFor("g2");
    await setStatus(host, "closed");
    expect((await vote(await as("late@example.com"), "g1")).status).toBe(409);

    await setStatus(host, "open");
    expect((await game()).vote).toMatchObject({ status: "open", winner: null, cast: 1 });
  });

  it("closes with no winner if nobody voted", async () => {
    const { host, setStatus, game } = await finished();
    await setStatus(host, "open");
    expect((await setStatus(host, "closed")).status).toBe(204);
    expect((await game()).vote).toMatchObject({ status: "closed", winner: null, cast: 0 });
  });
});
