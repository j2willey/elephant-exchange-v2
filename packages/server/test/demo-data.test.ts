import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

const HOUR = 60 * 60_000;
const photo = () => sharp({ create: { width: 64, height: 48, channels: 3, background: "#c33" } }).jpeg().toBuffer();

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "elephant-demo-data-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A server on a real database file (so it can be backed up), with an admin, a movable clock and these helpers. */
async function setup() {
  let at = Date.UTC(2026, 10, 25, 18);
  const { sent, mailer } = capturingMailer();
  const backupsDir = join(dir, "backups");
  const server = createServer({ dbPath: join(dir, "elephant.db"), backupsDir, photosDir: join(dir, "photos"), mailer, now: () => new Date(at), adminEmails: ["jim@example.org"] });
  const { app } = server;
  const jim = await signIn(app, sent, "jim@example.org");
  const newGame = async (cookie: string, body: object) =>
    ((await (await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 }, ...body }, cookie))).json()) as { id: string }).id;
  const visitor = async () => (await app.request("/api/demo/visitor", post({}))).headers.get("set-cookie")!.match(/^session=[^;]+/)![0];
  const postPhoto = async (cookie: string, gameId: string) => {
    const form = new FormData();
    form.append("name", "Host");
    form.append("photo", new Blob([new Uint8Array(await photo())], { type: "image/jpeg" }), "p.jpg");
    return app.request(`/api/games/${gameId}/posts`, { method: "POST", body: form, headers: { cookie } });
  };
  const admin = (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { cookie: jim } });
  const later = (ms: number) => (at += ms);
  return { app, sent, backupsDir, newGame, visitor, postPhoto, admin, later, sweep: server.sweep };
}

describe("Delete demo data", () => {
  it("counts first, then deletes the visitors' demo Games and accounts after a backup, keeping real Games and new visitors", async () => {
    const { app, sent, backupsDir, newGame, visitor, postPhoto, admin, later } = await setup();
    // Real Games: a party, and a signed-in Host's own demo.
    const ted = await signIn(app, sent, "ted@novuz.example");
    const party = await newGame(ted, { name: "Holiday fun" });
    const tedsDemo = await newGame(ted, { name: "Demo game", demo: true });
    // Two visitors' demos, one with a Photo.
    const ann = await visitor();
    const annsDemo = await newGame(ann, { name: "Demo game", demo: true });
    expect((await postPhoto(ann, annsDemo)).status).toBe(201);
    const bob = await visitor();
    const bobsDemo = await newGame(bob, { name: "Demo game", demo: true });
    later(2 * HOUR);
    // A visitor in the middle of a demo now.
    const cat = await visitor();
    const catsDemo = await newGame(cat, { name: "Demo game", demo: true });

    expect(await (await admin("/api/admin/demo-data")).json()).toEqual({ games: 2, visitors: 2, photos: 1 });
    expect(existsSync(backupsDir)).toBe(false); // counting deletes nothing, and backs nothing up

    const res = await admin("/api/admin/demo-data/delete", { method: "POST" });
    expect(res.status).toBe(200);
    const result = (await res.json()) as { games: number; visitors: number; photos: number; backup: string };
    expect(result).toMatchObject({ games: 2, visitors: 2, photos: 1, backup: expect.stringMatching(/^elephant-.*\.db$/) });
    expect(existsSync(join(backupsDir, result.backup))).toBe(true);

    const opens = async (id: string) => (await app.request(`/api/games/${id}`, { headers: { cookie: ted } })).status;
    expect(await opens(annsDemo)).toBe(404);
    expect(await opens(bobsDemo)).toBe(404);
    expect(await opens(party)).toBe(200);
    expect(await opens(tedsDemo)).toBe(200);
    expect(await opens(catsDemo)).toBe(200);
    // Ann's stand-in account is gone; Cat's still works.
    expect(((await (await app.request("/api/session", { headers: { cookie: ann } })).json()) as { email?: string }).email).toBeUndefined();
    expect((await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 }, demo: true }, cat))).status).toBe(201);
    expect(await (await admin("/api/admin/demo-data")).json()).toEqual({ games: 0, visitors: 0, photos: 0 });
  });

  it("is only for admins", async () => {
    const { app, sent } = await setup();
    const ted = await signIn(app, sent, "ted@novuz.example");
    expect((await app.request("/api/admin/demo-data", { headers: { cookie: ted } })).status).toBe(404);
    expect((await app.request("/api/admin/demo-data/delete", post({}, ted))).status).toBe(404);
  });
});

describe("Demos started", () => {
  it("counts each demo started (Create demo game, a guided tour's first Game), and deleting the Games doesn't change it", async () => {
    const { visitor, newGame, admin, later } = await setup();
    const ann = await visitor();
    await newGame(ann, { demo: true, demoStart: "self" });
    const bob = await visitor();
    await newGame(bob, { demo: true, demoStart: "guided" });
    await newGame(bob, { demo: true }); // the tour's Back: a fresh Game, not a new demo
    await newGame(bob, { demo: true });
    const started = async () => ((await (await admin("/api/admin/stats")).json()) as { insights: { demosStarted: unknown } }).insights.demosStarted;

    expect(await started()).toEqual([{ day: "2026-11-25", self: 1, guided: 1 }]);
    later(2 * HOUR);
    await admin("/api/admin/demo-data/delete", { method: "POST" });
    expect(await started()).toEqual([{ day: "2026-11-25", self: 1, guided: 1 }]);
  });
});

describe("A visitor's demo Game", () => {
  it("is deleted 48 hours after its last move or Post; the visitor stays, and a signed-in Host's demo is kept", async () => {
    const { app, sent, newGame, visitor, later, sweep } = await setup();
    const ted = await signIn(app, sent, "ted@novuz.example");
    const tedsDemo = await newGame(ted, { name: "Demo game", demo: true });
    const ann = await visitor();
    const idle = await newGame(ann, { name: "Demo game", demo: true });
    const bob = await visitor();
    const played = await newGame(bob, { name: "Demo game", demo: true });
    const chatty = await newGame(bob, { name: "Demo game", demo: true });
    const opens = async (id: string) => (await app.request(`/api/games/${id}`, { headers: { cookie: ted } })).status;

    later(40 * HOUR);
    await app.request(`/api/games/${played}/commands`, post({ type: "AddPlayer", playerId: "p1", name: "Pia" }, bob)); // a move
    await app.request(`/api/games/${chatty}/posts`, post({ text: "Still here", name: "Host" }, bob)); // a Post
    later(9 * HOUR); // 49 hours in
    expect(sweep().demoGamesExpired).toBe(1);
    expect(await opens(idle)).toBe(404);
    expect([await opens(played), await opens(chatty), await opens(tedsDemo)]).toEqual([200, 200, 200]);
    // Ann's still a visitor: she can start another demo.
    expect((await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 }, demo: true }, ann))).status).toBe(201);

    later(40 * HOUR); // 49 hours after the move and the Post
    sweep();
    expect([await opens(played), await opens(chatty), await opens(tedsDemo)]).toEqual([404, 404, 200]);
  });
});
