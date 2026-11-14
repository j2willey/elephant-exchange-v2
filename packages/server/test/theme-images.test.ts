import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

let themesDir: string;
beforeEach(() => {
  themesDir = mkdtempSync(join(tmpdir(), "elephant-themes-"));
});
afterEach(() => rmSync(themesDir, { recursive: true, force: true }));

/** A big logo with see-through corners, carrying EXIF as a camera or design tool might leave. */
const bigLogo = () =>
  sharp({ create: { width: 2000, height: 1000, channels: 4, background: { r: 200, g: 16, b: 46, alpha: 0 } } })
    .composite([{ input: { create: { width: 1000, height: 500, channels: 4, background: "#c8102e" } }, top: 250, left: 500 }])
    .withExif({ IFD0: { Artist: "Someone Private" } })
    .png()
    .toBuffer();
const backdrop = () => sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#0b3d2e" } }).jpeg().toBuffer();

async function setup() {
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer, themesDir });
  const host = await signIn(app, sent, "host@example.com");
  const as = (email: string) => signIn(app, sent, email);
  const org = ((await (await app.request("/api/orgs", post({ name: "Lodge 22" }, host))).json()) as { id: string }).id;
  const game = ((await (await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 }, orgId: org }, host))).json()) as { id: string }).id;
  const upload = (cookie: string, path: string, image: Uint8Array) => {
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(image)], { type: "image/png" }), "logo.png");
    return app.request(path, { method: "PUT", body: form, headers: { cookie } });
  };
  const remove = (cookie: string, path: string) => app.request(path, { method: "DELETE", headers: { cookie } });
  type Theme = { logoUrl: string | null; backgroundUrl: string | null };
  const theme = async () => ((await (await app.request(`/api/games/${game}`)).json()) as { theme: Theme }).theme;
  return { app, host, as, org, game, upload, remove, theme };
}

describe("Theme images", () => {
  it("lets the Organizer give the Organization a logo, kept small and without its metadata, with transparency", async () => {
    const { app, host, org, upload, theme } = await setup();

    expect((await upload(host, `/api/orgs/${org}/logo`, await bigLogo())).status).toBe(200);

    const { logoUrl } = await theme();
    expect(logoUrl).toMatch(new RegExp(`^/api/orgs/${org}/logo\\?v=`));
    const res = await app.request(logoUrl!);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toMatch(/immutable/);
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 600, height: 300, hasAlpha: true });
    expect(meta.exif).toBeUndefined();
  });

  it("gives each upload a new address, so screens never keep showing an old logo", async () => {
    const { host, org, upload, theme } = await setup();
    await upload(host, `/api/orgs/${org}/logo`, await bigLogo());
    const first = (await theme()).logoUrl;
    await upload(host, `/api/orgs/${org}/logo`, await bigLogo());
    expect((await theme()).logoUrl).not.toBe(first);
  });

  it("lets a Game override the background, and falls back to the Organization's when that's removed", async () => {
    const { app, host, org, game, upload, remove, theme } = await setup();
    await upload(host, `/api/orgs/${org}/background`, await backdrop());
    expect((await theme()).backgroundUrl).toMatch(/^\/api\/orgs\//);

    await upload(host, `/api/games/${game}/theme/background`, await backdrop());
    const own = (await theme()).backgroundUrl!;
    expect(own).toMatch(new RegExp(`^/api/games/${game}/theme/background\\?v=`));
    const meta = await sharp(Buffer.from(await (await app.request(own)).arrayBuffer())).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(2400);

    expect((await remove(host, `/api/games/${game}/theme/background`)).status).toBe(200);
    expect((await theme()).backgroundUrl).toMatch(/^\/api\/orgs\//);
    await remove(host, `/api/orgs/${org}/background`);
    expect((await theme()).backgroundUrl).toBeNull();
    expect((await app.request(own)).status).toBe(404);
  });

  it("takes images only from the Organizer (or the Game's Hosts), and only real images", async () => {
    const { as, host, org, game, upload } = await setup();
    const gus = await as("gus@example.com");
    expect((await upload(gus, `/api/orgs/${org}/logo`, await bigLogo())).status).toBe(403);
    expect((await upload(gus, `/api/games/${game}/theme/logo`, await bigLogo())).status).toBe(403);
    expect((await upload(host, `/api/orgs/${org}/logo`, new TextEncoder().encode("not an image"))).status).toBe(400);
    expect((await upload(host, `/api/orgs/${org}/banner`, await bigLogo())).status).toBe(404);
  });
});
