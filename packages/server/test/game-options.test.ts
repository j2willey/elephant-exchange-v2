import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, hostGame, post, signIn } from "./support.js";

const patch = (body: unknown, cookie?: string) => ({ ...post(body, cookie), method: "PATCH" });
type Shown = { name: string; tagline: string; whenWhere: string; rosterMode: string; clock: { turnSeconds: number } };

async function setup() {
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer });
  const { id, cookie } = await hostGame(app, sent);
  const shown = async () => (await (await app.request(`/api/games/${id}`)).json()) as Shown;
  return { app, sent, id, host: cookie, shown };
}

describe("A Game's options", () => {
  it("can be changed by the Host: its name, the turn timer, and who adds the Players", async () => {
    const { app, id, host, shown } = await setup();

    const res = await app.request(`/api/games/${id}/options`, patch({ name: "OA Holiday Party", turnSeconds: 90, rosterMode: "self" }, host));

    expect(res.status).toBe(200);
    expect(await shown()).toMatchObject({ name: "OA Holiday Party", rosterMode: "self", clock: { turnSeconds: 90 } });
  });

  it("include a tagline under the name, none to start with, which can be taken off again", async () => {
    const { app, id, host, shown } = await setup();
    expect(await shown()).toMatchObject({ tagline: "" });

    await app.request(`/api/games/${id}/options`, patch({ tagline: "  It's going to be a gas!  " }, host));
    expect(await shown()).toMatchObject({ tagline: "It's going to be a gas!" });

    expect((await app.request(`/api/games/${id}/options`, patch({ tagline: "x".repeat(101) }, host))).status).toBe(400);
    await app.request(`/api/games/${id}/options`, patch({ tagline: "" }, host));
    expect(await shown()).toMatchObject({ tagline: "" });
  });

  it("include When & where for the welcome screen, none to start with, which can be taken off again", async () => {
    const { app, id, host, shown } = await setup();
    expect(await shown()).toMatchObject({ whenWhere: "" });

    await app.request(`/api/games/${id}/options`, patch({ whenWhere: "  Fri Dec 12, 10 am · Room B " }, host));
    expect(await shown()).toMatchObject({ whenWhere: "Fri Dec 12, 10 am · Room B" });

    expect((await app.request(`/api/games/${id}/options`, patch({ whenWhere: "x".repeat(121) }, host))).status).toBe(400);
    await app.request(`/api/games/${id}/options`, patch({ whenWhere: "" }, host));
    expect(await shown()).toMatchObject({ whenWhere: "" });
  });

  it("can be changed one at a time", async () => {
    const { app, id, host, shown } = await setup();
    await app.request(`/api/games/${id}/options`, patch({ turnSeconds: 0 }, host));
    expect(await shown()).toMatchObject({ name: "Gift exchange", rosterMode: "host", clock: { turnSeconds: 0 } });
  });

  it("are kept after a restart", async () => {
    const { sent, mailer } = capturingMailer();
    const dbPath = join(mkdtempSync(join(tmpdir(), "options-")), "elephant.db");
    const first = createServer({ dbPath, mailer });
    const { id, cookie } = await hostGame(first.app, sent);
    await first.app.request(`/api/games/${id}/options`, patch({ name: "Kept" }, cookie));
    const second = createServer({ dbPath, mailer });
    expect(((await (await second.app.request(`/api/games/${id}`)).json()) as Shown).name).toBe("Kept");
  });

  it("can't be changed by anyone else, or to something out of range", async () => {
    const { app, sent, id, host } = await setup();
    const guest = await signIn(app, sent, "gus@example.com");
    expect((await app.request(`/api/games/${id}/options`, patch({ name: "Mine now" }, guest))).status).toBe(403);
    expect((await app.request(`/api/games/${id}/options`, patch({ name: "Mine now" }))).status).toBe(401);
    expect((await app.request(`/api/games/${id}/options`, patch({ turnSeconds: 601 }, host))).status).toBe(400);
    expect((await app.request(`/api/games/${id}/options`, patch({ name: "  " }, host))).status).toBe(400);
  });
});
