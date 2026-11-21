import { dirname, join } from "node:path";
import { resendMailer } from "./mailer.js";
import { createServer } from "./server.js";

// Settings come from the environment, so the same code runs on a laptop and on the droplet.
const env = process.env;

// With a Resend key, sign-in links are emailed; without one (on a laptop) they're written to the log.
const apiKey = env["RESEND_API_KEY"];
const from = env["MAIL_FROM"];
if (apiKey && !from) {
  console.error("RESEND_API_KEY is set but MAIL_FROM isn't: set it to an address on your Resend-verified domain");
  process.exit(1);
}
if (!apiKey) console.warn("RESEND_API_KEY isn't set: sign-in links will be written to this log, not emailed");
const server = createServer({
  dbPath: env["DB_PATH"] ?? "elephant.db",
  photosDir: env["PHOTOS_DIR"] ?? "photos",
  themesDir: env["THEMES_DIR"] ?? "themes",
  // Where people open the app; sign-in links point here. In development that's Vite's dev server.
  baseUrl: env["BASE_URL"] ?? "http://localhost:5173",
  trustProxy: env["TRUST_PROXY"] === "1",
  ...(apiKey && from ? { mailer: resendMailer({ apiKey, from }) } : {}),
  // The built web app, in production. In development it's left unset and Vite serves the app.
  ...(env["WEB_ROOT"] ? { webRoot: env["WEB_ROOT"] } : {}),
  // Who may use the admin pages: comma-separated emails. Unset, nobody can.
  adminEmails: (env["ADMIN_EMAILS"] ?? "").split(","),
  // Sign-in links emailed per day, site-wide: match it to the Resend plan (the free plan allows 100).
  // At a big party, a burst of Posts and Reactions sends phones back for the Feed at most this often (ms).
  feedSignalMs: Number(env["FEED_SIGNAL_MS"] ?? 2000),
  // Past either of these, new Games are asked to try again in a few minutes, so parties under way stay smooth.
  overload: { maxScreens: Number(env["MAX_SCREENS"] ?? 6000), maxLagMs: Number(env["MAX_LAG_MS"] ?? 300) },
  // The tag that starts each new Game's id, naming this server: "a" unless set (docs/scale-plan.md, "One server per Game").
  // Where backup.ts puts the database's backups (scripts/backup.sh: /data/backups), for the admin's System page.
  backupsDir: env["BACKUP_DIR"] ?? join(dirname(env["DB_PATH"] ?? "elephant.db"), "backups"),
  ...(env["SERVER_TAG"] ? { serverTag: env["SERVER_TAG"] } : {}),
  ...(env["SIGNIN_LINKS_PER_DAY"] ? { limits: { perDay: Number(env["SIGNIN_LINKS_PER_DAY"]) } } : {}),
});
const { port, close } = await server.listen(Number(env["PORT"] ?? 3001));
console.log(`Elephant Exchange server listening on port ${port}`);

// `docker stop` sends SIGTERM (Ctrl-C sends SIGINT): finish cleanly, so the database file is left whole.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    console.log(`${signal}: shutting down`);
    close().then(
      () => process.exit(0),
      (err: unknown) => {
        console.error("Shutdown failed", err);
        process.exit(1);
      },
    );
  });
}
