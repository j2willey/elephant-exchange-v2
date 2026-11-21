import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

type Photo = { url: string; width: number; height: number };
type Post = { id: string; author: string; text: string; status: string; photo: Photo | null };

/** A camera-like JPEG: 3000×2000 as stored, marked to be turned upright (portrait), with the camera's EXIF and a GPS fix. */
const cameraPhoto = () =>
  sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .withExif({
      IFD0: { Make: "PhoneCo", Model: "Phone 9", Artist: "Ann Example" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 26/1 46/1", GPSLongitudeRef: "W", GPSLongitude: "79/1 58/1 56/1" },
    })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();

let photosDir: string;
beforeEach(() => {
  photosDir = mkdtempSync(join(tmpdir(), "elephant-photos-"));
});
afterEach(() => rmSync(photosDir, { recursive: true, force: true }));

async function setup() {
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer, photosDir, draw: (c) => c[0]! });
  const host = await signIn(app, sent, "host@example.com");
  const res = await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 } }, host));
  const { id } = (await res.json()) as { id: string };
  const as = (email: string) => signIn(app, sent, email);
  /** Posts the way the web app does with a Photo: a multipart form. */
  const postPhoto = (cookie: string, photo: Uint8Array | null, fields: Record<string, string> = {}) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    if (photo) form.append("photo", new Blob([new Uint8Array(photo)], { type: "image/jpeg" }), "IMG_0001.jpg");
    return app.request(`/api/games/${id}/posts`, { method: "POST", body: form, headers: { cookie } });
  };
  const read = async (cookie?: string) =>
    (await (await app.request(`/api/games/${id}/posts`, cookie ? { headers: { cookie } } : {})).json()) as Post[];
  const fetchPhoto = (url: string, cookie?: string) => app.request(url, cookie ? { headers: { cookie } } : {});
  return { app, id, host, as, postPhoto, read, fetchPhoto };
}

describe("Posting a Photo", () => {
  it("keeps it upright and no bigger than 1600px, with the camera's details and location taken out", async () => {
    const { as, postPhoto, read, fetchPhoto } = await setup();
    const gus = await as("gus@example.com");

    const res = await postPhoto(gus, await cameraPhoto(), { text: "Look at this", name: "Gus" });

    expect(res.status).toBe(201);
    const [p] = await read();
    expect(p).toMatchObject({ author: "Gus", text: "Look at this", photo: { width: 1067, height: 1600 } });
    const img = await fetchPhoto(p!.photo!.url);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(await img.arrayBuffer())).metadata();
    expect(meta).toMatchObject({ format: "jpeg", width: 1067, height: 1600 });
    expect(meta.exif).toBeUndefined(); // no GPS, camera or name
    expect(meta.orientation ?? 1).toBe(1);
  });

  it("needs no words, but needs words or a Photo", async () => {
    const { as, postPhoto, read } = await setup();
    const gus = await as("gus@example.com");

    expect((await postPhoto(gus, await cameraPhoto(), { name: "Gus" })).status).toBe(201);
    expect((await postPhoto(gus, null, { name: "Gus", text: "  " })).status).toBe(400);
    expect(await read()).toMatchObject([{ text: "", photo: { height: 1600 } }]);
  });

  it("leaves a Post without one as it was", async () => {
    const { as, app, id, read } = await setup();
    const gus = await as("gus@example.com");
    await app.request(`/api/games/${id}/posts`, post({ text: "Words only", name: "Gus" }, gus));
    expect(await read()).toMatchObject([{ text: "Words only", photo: null }]);
  });

  it("refuses something that isn't a photo, and one too big to send", async () => {
    const { as, postPhoto, read } = await setup();
    const gus = await as("gus@example.com");

    expect((await postPhoto(gus, new TextEncoder().encode("not a picture"), { name: "Gus" })).status).toBe(400);
    expect((await postPhoto(gus, new Uint8Array(13 * 1024 * 1024), { name: "Gus" })).status).toBe(413);
    expect(await read()).toEqual([]);
  });

  it("shows a held or Hidden Post's Photo only to its poster and the Hosts", async () => {
    const { app, id, host, as, postPhoto, read, fetchPhoto } = await setup();
    await app.request(`/api/games/${id}/moderation`, post({ mode: "approval" }, host));
    const gus = await as("gus@example.com");
    const other = await as("other@example.com");
    await postPhoto(gus, await cameraPhoto(), { name: "Gus" });
    const [held] = await read(host);
    const url = held!.photo!.url;

    expect((await fetchPhoto(url, gus)).status).toBe(200);
    expect((await fetchPhoto(url, host)).status).toBe(200);
    expect((await fetchPhoto(url, other)).status).toBe(404);
    expect((await fetchPhoto(url)).status).toBe(404);

    await app.request(`/api/games/${id}/posts/${held!.id}/status`, post({ status: "visible" }, host));
    expect((await fetchPhoto(url)).status).toBe(200);
    await app.request(`/api/games/${id}/posts/${held!.id}/status`, post({ status: "hidden" }, host));
    expect((await fetchPhoto(url, other)).status).toBe(404);
  });
});

describe("Serving Photos to a busy party", () => {
  type Sized = Photo & { smallUrl: string };

  it("has a small copy, no bigger than 640px and much lighter, for the Feed and the scoreboard's lists", async () => {
    const { as, postPhoto, read, fetchPhoto } = await setup();
    await postPhoto(await as("gus@example.com"), await cameraPhoto(), { name: "Gus" });
    const photo = (await read())[0]!.photo as Sized;

    const full = Buffer.from(await (await fetchPhoto(photo.url)).arrayBuffer());
    const small = Buffer.from(await (await fetchPhoto(photo.smallUrl)).arrayBuffer());

    expect(await sharp(small).metadata()).toMatchObject({ format: "jpeg", width: 427, height: 640 }); // still upright
    expect(small.length).toBeLessThan(full.length / 2);
  });

  it("lets a shared cache (Cloudflare) keep a visible Photo for a few minutes, never a held one", async () => {
    const { app, id, host, as, postPhoto, read, fetchPhoto } = await setup();
    await app.request(`/api/games/${id}/moderation`, post({ mode: "approval" }, host));
    const gus = await as("gus@example.com");
    await postPhoto(gus, await cameraPhoto(), { name: "Gus" });
    const held = (await read(host))[0]!;
    const photo = held.photo as Sized;

    for (const url of [photo.url, photo.smallUrl]) {
      expect(url).toMatch(/\.jpg$/); // what Cloudflare caches by default
      expect((await fetchPhoto(url, gus)).headers.get("cache-control")).toMatch(/^private/);
    }

    await app.request(`/api/games/${id}/posts/${held.id}/status`, post({ status: "visible" }, host));
    for (const url of [photo.url, photo.smallUrl]) expect((await fetchPhoto(url)).headers.get("cache-control")).toBe("public, max-age=600");
  });

  it("still answers at a Photo's old address, from pages loaded before", async () => {
    const { as, postPhoto, read, fetchPhoto } = await setup();
    await postPhoto(await as("gus@example.com"), await cameraPhoto(), { name: "Gus" });
    const photo = (await read())[0]!.photo!;

    const old = await fetchPhoto(photo.url.replace(/\.jpg$/, ""));

    expect(old.status).toBe(200);
    expect(old.headers.get("content-type")).toBe("image/jpeg");
  });

  it("makes the small copy of a Photo kept before there were any, the first time it's asked for", async () => {
    const { id, as, postPhoto, read, fetchPhoto } = await setup();
    await postPhoto(await as("gus@example.com"), await cameraPhoto(), { name: "Gus" });
    const p = (await read())[0]!;
    rmSync(join(photosDir, id, `${p.id}-small.jpg`)); // as if posted before small copies

    const small = await fetchPhoto((p.photo as Sized).smallUrl);

    expect(small.status).toBe(200);
    expect(await sharp(Buffer.from(await small.arrayBuffer())).metadata()).toMatchObject({ width: 427, height: 640 });
  });
});
