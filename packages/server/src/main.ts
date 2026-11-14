import { createServer } from "./server.js";

// Settings come from the environment, so the same code runs on a laptop and on the droplet.
const env = process.env;
const server = createServer({
  dbPath: env["DB_PATH"] ?? "elephant.db",
  // Where people open the app; sign-in links point here. In development that's Vite's dev server.
  baseUrl: env["BASE_URL"] ?? "http://localhost:5173",
  trustProxy: env["TRUST_PROXY"] === "1",
});
const { port } = await server.listen(Number(env["PORT"] ?? 3001));
console.log(`Elephant Exchange server listening on port ${port}`);
