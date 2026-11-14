import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, scriptedDraw, signIn } from "./support.js";

const DAY = 24 * 60 * 60_000;
const photo = () => sharp({ create: { width: 64, height: 48, channels: 3, background: "#c33" } }).jpeg().toBuffer();

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "elephant-keep-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function setup() {
  let at = Date.UTC(2026, 11, 13, 19);
  const { sent, mailer } = capturingMailer();
  const photosDir = join(dir, "photos");
  const server = createServer({ dbPath: ":memory:", mailer, photosDir, now: () => new Date(at), draw: scriptedDraw(["ann", "bob"]) });
  const { app } = server;
  const host = await signIn(app, sent, "host@example.com");
  const { id } = (await (await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 } }, host))).json()) as { id: string };
  const command = (cmd: unknown) => app.request(`/api/games/${id}/commands`, post(cmd, host));
  for (const p of ["ann", "bob"]) await command({ type: "AddPlayer", playerId: p, name: p.toUpperCase() });
  await command({ type: "StartGame" });
  const as = (email: string) => signIn(app, sent, email);
  const postPhoto = async (cookie: string, name: string, text?: string) => {
    const form = new FormData();
    form.append("name", name);
    if (text) form.append("text", text);
    form.append("photo", new Blob([new Uint8Array(await photo())], { type: "image/jpeg" }), "p.jpg");
    return app.request(`/api/games/${id}/posts`, { method: "POST", body: form, headers: { cookie } });
  };
  type Post = { id: string; author: string; text: string; photo: { url: string } | null };
  const read = async () => (await (await app.request(`/api/games/${id}/posts`, { headers: { cookie: host } })).json()) as Post[];
  const advance = (days: number) => (at += days * DAY);
  return { app, id, host, as, command, postPhoto, read, advance, sweep: server.sweep, photosDir };
}

describe("Keeping Photos", () => {
  it("deletes a Game's Photos 60 days after its last move, keeping the words of Posts that had some", async () => {
    const { id, as, command, postPhoto, read, advance, sweep, app, photosDir } = await setup();
    const gus = await as("gus@example.com");
    await postPhoto(gus, "Gus", "The whole troop");
    await postPhoto(gus, "Gus");
    const [onlyPhoto, withWords] = await read();
    await command({ type: "EndGame" });

    advance(59);
    expect(sweep()).toMatchObject({ photos: 0 });
    expect((await app.request(onlyPhoto!.photo!.url)).status).toBe(200);

    advance(2);
    expect(sweep()).toMatchObject({ photos: 2 });

    expect(await read()).toMatchObject([{ id: withWords!.id, text: "The whole troop", photo: null }]);
    expect((await app.request(withWords!.photo!.url)).status).toBe(404);
    expect(existsSync(join(photosDir, id))).toBe(false);
    expect(sweep()).toMatchObject({ photos: 0 }); // nothing left to do
  });

  it("counts from the last move, so a Game still going keeps its Photos", async () => {
    const { app, id, as, postPhoto, read, advance, sweep } = await setup();
    await postPhoto(await as("gus@example.com"), "Gus");

    advance(50);
    const host = await as("host@example.com"); // signed in afresh: sign-ins last 30 days
    const move = await app.request(`/api/games/${id}/commands`, post({ type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" }, host));
    expect(move.status).toBe(200);
    advance(50);

    expect(sweep()).toMatchObject({ photos: 0 });
    expect(await read()).toHaveLength(1);
  });
});

describe("The album", () => {
  it("is every visible Photo in one zip, numbered in the order posted, with who posted each and what they said", async () => {
    const { app, id, host, as, postPhoto, read } = await setup();
    const gus = await as("gus@example.com");
    await postPhoto(gus, "Gus", "First one");
    await postPhoto(gus, "Ann/../Smith", "Second");
    await postPhoto(gus, "Gus", "Rude");
    await app.request(`/api/games/${id}/posts`, post({ text: "Words, no Photo", name: "Gus" }, gus));
    const rude = (await read()).find((p) => p.text === "Rude")!;
    await app.request(`/api/games/${id}/posts/${rude.id}/status`, post({ status: "hidden" }, host));

    const res = await app.request(`/api/games/${id}/album.zip`, { headers: { cookie: host } });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="[^"]*photos\.zip"/i);
    const zipFile = join(dir, "album.zip");
    writeFileSync(zipFile, Buffer.from(await res.arrayBuffer()));
    // Read back with Python's zipfile: an independent reader, which also checks every file's CRC.
    const listing = execFileSync("python3", [
      "-c",
      "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print('\\n'.join(z.namelist())); print(z.read('captions.txt').decode())",
      zipFile,
    ]).toString();
    const [names, captions] = [listing.split("\n").slice(0, 3), listing.split("\n").slice(3).join("\n")];
    expect(names).toEqual(["01-Gus.jpg", "02-Ann-Smith.jpg", "captions.txt"]);
    expect(captions).toMatch(/01-Gus\.jpg\s+Gus: First one/);
    expect(captions).toMatch(/02-Ann-Smith\.jpg\s+Ann\/\.\.\/Smith: Second/);
    expect(captions).not.toMatch(/rude/i);
  });

  it("is only for the Host and Co-hosts", async () => {
    const { app, id, as } = await setup();
    expect((await app.request(`/api/games/${id}/album.zip`)).status).toBe(401);
    const gus = await as("gus@example.com");
    expect((await app.request(`/api/games/${id}/album.zip`, { headers: { cookie: gus } })).status).toBe(403);
  });
});
