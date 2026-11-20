import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

/** Serving the built web app, as the server does in production (there's no Vite there). */
describe("The web app", () => {
  let webRoot: string;
  beforeEach(() => {
    webRoot = mkdtempSync(join(tmpdir(), "elephant-web-"));
    writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>Elephant Exchange</title>");
    mkdirSync(join(webRoot, "assets"));
    writeFileSync(join(webRoot, "assets", "app-abc123.js"), "console.log('hi')");
  });
  afterEach(() => rmSync(webRoot, { recursive: true, force: true }));

  const app = () => createServer({ dbPath: ":memory:", webRoot }).app;

  it("serves the app's page at its home and at any of its own addresses, such as a Game's link", async () => {
    for (const path of ["/", "/games/abc123", "/games/abc123/screen", "/sign-in?token=x"]) {
      const res = await app().request(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toMatch(/text\/html/);
      expect(await res.text(), path).toContain("<title>Elephant Exchange</title>");
      // The page names the current build's files, so it must never be cached, or a phone would keep an old app.
      expect(res.headers.get("cache-control"), path).toMatch(/no-cache/);
    }
  });

  it("serves the build's files, cached for good since their names change with every build", async () => {
    const res = await app().request("/assets/app-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    expect(res.headers.get("cache-control")).toMatch(/immutable/);
  });

  it("answers a missing build file or API address with 404, not the app's page", async () => {
    expect((await app().request("/assets/gone.js")).status).toBe(404);
    const api = await app().request("/api/nothing-here");
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ error: "Not found" });
  });

  it("never serves files from outside the build", async () => {
    for (const path of ["/../package.json", "/assets/../../etc/passwd", "/%2e%2e/package.json"]) {
      const res = await app().request(path);
      expect(await res.text(), path).not.toContain('"name"');
    }
  });
});

/** After a deploy, a page still running the old build should find out, so it can offer to reload. */
describe("Saying which build is current", () => {
  it("names the build, from the page's main script, on every API answer", async () => {
    const webRoot = mkdtempSync(join(tmpdir(), "elephant-web-"));
    try {
      writeFileSync(join(webRoot, "index.html"), '<!doctype html><script type="module" crossorigin src="/assets/index-B7x_q2-a.js"></script>');
      const { app } = createServer({ dbPath: ":memory:", webRoot });
      for (const path of ["/api/health", "/api/session", "/api/nothing-here"]) {
        expect((await app.request(path)).headers.get("x-app-build"), path).toBe("B7x_q2-a");
      }
    } finally {
      rmSync(webRoot, { recursive: true, force: true });
    }
  });

  it("says nothing in development, where there's no build", async () => {
    const { app } = createServer({ dbPath: ":memory:" });
    expect((await app.request("/api/health")).headers.get("x-app-build")).toBeNull();
  });
});
