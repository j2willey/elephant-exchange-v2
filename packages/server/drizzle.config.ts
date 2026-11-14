import { defineConfig } from "drizzle-kit";

// `npm run db:generate` writes a new migration after a change to the tables in src/db.ts.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db.ts",
  out: "./drizzle",
});
