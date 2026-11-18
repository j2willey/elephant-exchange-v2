import { defineConfig, devices } from "@playwright/test";

/**
 * The smoke test: real browsers against a running, packaged app (the Docker image locally, or the droplet).
 * Start it first (docker compose up -d --build), then: npm run smoke
 */
const baseURL = process.env["SMOKE_URL"] ?? "http://localhost:3000";

// Against anything but this machine (the live site, say), each run signs in made-up @example.com addresses. With
// Resend switched on there, that sends real emails: a few of the day's allowance gone, and bounces that count
// against the sender's reputation. So it takes saying so: SMOKE_ALLOW_EMAIL=1.
const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname);
if (!local && process.env["SMOKE_ALLOW_EMAIL"] !== "1") {
  throw new Error(
    `The smoke test would sign in test addresses at ${baseURL}, which emails them if Resend is on there ` +
      "(using the day's allowance, and bouncing). If that's what you want, run it again with SMOKE_ALLOW_EMAIL=1.",
  );
}

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    ...devices["Pixel 7"], // phone-sized: it's a phone-first app
    trace: "retain-on-failure",
  },
});
