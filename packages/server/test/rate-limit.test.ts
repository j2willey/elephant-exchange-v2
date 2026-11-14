import { describe, expect, it } from "vitest";
import { createServer, type ServerOptions } from "../src/server.js";
import { capturingMailer, post } from "./support.js";

function setup(options: Partial<ServerOptions> = {}) {
  let now = new Date("2026-12-13T18:00:00Z");
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer, now: () => now, trustProxy: true, ...options });
  const advance = (minutes: number) => (now = new Date(now.getTime() + minutes * 60_000));
  /** Asks for a link as someone at this IP address (as the proxy in front of the server reports it). */
  const ask = (email: string, ip = "203.0.113.7") =>
    app.request("/api/auth/link", {
      ...post({ email }),
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
    });
  return { app, sent, advance, ask };
}

describe("Limits on emailing sign-in links", () => {
  it("emails one address at most 3 links in 15 minutes, then again once they age out", async () => {
    const { sent, advance, ask } = setup();
    for (let i = 0; i < 3; i++) expect((await ask("ann@example.com")).status).toBe(202);

    expect((await ask("ann@example.com")).status).toBe(429);
    expect(sent).toHaveLength(3);

    advance(15);
    expect((await ask("ann@example.com")).status).toBe(202);
  });

  it("lets a whole party on the venue's Wi-Fi sign in at once", async () => {
    const { sent, advance, ask } = setup();
    for (let i = 0; i < 80; i++) {
      expect((await ask(`guest${i}@example.com`)).status).toBe(202);
      if (i % 8 === 0) advance(1); // 80 people over 10 minutes
    }
    expect(sent).toHaveLength(80);
  });

  it("sends one IP address at most 120 links an hour, without blocking anyone else", async () => {
    const { advance, ask } = setup({ limits: { perDay: 1000 } });
    for (let i = 0; i < 120; i++) expect((await ask(`p${i}@example.com`)).status).toBe(202);

    expect((await ask("one-more@example.com")).status).toBe(429);
    expect((await ask("elsewhere@example.com", "198.51.100.9")).status).toBe(202);

    advance(60);
    expect((await ask("one-more@example.com")).status).toBe(202);
  });

  it("sends at most 100 links a day in all, to protect the email quota", async () => {
    const { sent, advance, ask } = setup();
    for (let i = 0; i < 100; i++) expect((await ask(`p${i}@example.com`, `198.51.100.${i}`)).status).toBe(202);

    expect((await ask("late@example.com", "192.0.2.1")).status).toBe(429);
    expect(sent).toHaveLength(100);

    advance(24 * 60);
    expect((await ask("late@example.com", "192.0.2.1")).status).toBe(202);
  });

  it("ignores a forged X-Forwarded-For unless told a proxy sets it", async () => {
    const { ask } = setup({ trustProxy: false, limits: { perIp: 2 } });
    expect((await ask("a@example.com", "10.0.0.1")).status).toBe(202);
    expect((await ask("b@example.com", "10.0.0.2")).status).toBe(202);
    // Same real client, a different made-up address: still counted as the same client.
    expect((await ask("c@example.com", "10.0.0.3")).status).toBe(429);
  });

  it("counts the address the proxy saw, not ones the client put in front of it", async () => {
    const { ask } = setup({ limits: { perIp: 2 } });
    expect((await ask("a@example.com", "10.0.0.1, 203.0.113.7")).status).toBe(202);
    expect((await ask("b@example.com", "10.0.0.2, 203.0.113.7")).status).toBe(202);
    expect((await ask("c@example.com", "10.0.0.3, 203.0.113.7")).status).toBe(429);
  });
});
