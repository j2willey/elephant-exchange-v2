import { defineConfig, devices } from "@playwright/test";

/**
 * The smoke test: real browsers against a running, packaged app (the Docker image locally, or the droplet).
 * Start it first (docker compose up -d --build), then: npm run smoke
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env["SMOKE_URL"] ?? "http://localhost:3000",
    ...devices["Pixel 7"], // phone-sized: it's a phone-first app
    trace: "retain-on-failure",
  },
});
