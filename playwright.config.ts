import { defineConfig, devices } from "@playwright/test";

/**
 * The smoke test: real browsers against a running, packaged app (the Docker image locally, or the droplet).
 * Start it first (docker compose up -d --build), then: npm run smoke
 */
const baseURL = process.env["SMOKE_URL"] ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    // Caddy's certificate for "localhost" comes from its own local CA, which the test browser doesn't know.
    ignoreHTTPSErrors: baseURL.startsWith("https://localhost"),
    ...devices["Pixel 7"], // phone-sized: it's a phone-first app
    trace: "retain-on-failure",
  },
});
