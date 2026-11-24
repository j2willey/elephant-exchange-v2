import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, signIn } from "./support.js";

describe("A brand-new server", () => {
  it("shows the admin Stats and System pages before anyone has posted a Photo (no photos folder yet)", async () => {
    const { sent, mailer } = capturingMailer();
    const photosDir = join(mkdtempSync(join(tmpdir(), "new-server-")), "photos"); // not made until the first Photo
    const { app } = createServer({ dbPath: ":memory:", mailer, adminEmails: ["jim@example.org"], photosDir });
    const jim = await signIn(app, sent, "jim@example.org");

    const stats = await app.request("/api/admin/stats", { headers: { cookie: jim } });
    expect(stats.status).toBe(200);
    expect(await stats.json()).toMatchObject({ insights: { costs: { photoBytes: 0 } } });

    const system = await app.request("/api/admin/system", { headers: { cookie: jim } });
    expect(system.status).toBe(200);
    expect(await system.json()).toMatchObject({ servers: [{ photoBytes: 0 }] });
  });
});
