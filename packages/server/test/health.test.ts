import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

/** What Docker and an uptime monitor ask to learn whether the app is up. */
describe("The health check", () => {
  it("says the app is up and its database answers", async () => {
    const res = await createServer({ dbPath: ":memory:" }).app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("says it's down once the database is closed", async () => {
    const server = createServer({ dbPath: ":memory:" });
    await (await server.listen(0)).close();
    const res = await server.app.request("/api/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
  });
});
