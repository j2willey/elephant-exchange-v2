import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    // In development the API and live updates come from the server on port 3001 (npm run dev -w packages/server).
    proxy: {
      "/api": "http://localhost:3001",
      "/socket.io": { target: "http://localhost:3001", ws: true },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    // Longer than any one wait (test/setup.ts gives each 5 s): on a busy CI runner a test with several steps can
    // need more than 5 s in all, and a wait that fails then shows what it was waiting for, not just "timed out".
    testTimeout: 15_000,
  },
});
