import { execSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

/**
 * Sign-in links are written to the server's log until email is set up, so the test reads them from there.
 * SMOKE_LOGS is the command that prints that log; by default, the local Docker Compose app's.
 */
const logsCommand = process.env["SMOKE_LOGS"] ?? "docker compose logs app --no-log-prefix";

function linkFor(email: string): string {
  const lines = execSync(logsCommand, { encoding: "utf8" }).split("\n");
  const line = lines.filter((l) => l.includes(`Sign-in link for ${email}: `)).at(-1);
  if (!line) throw new Error(`no sign-in link for ${email} in the server log`);
  const url = new URL(line.split(": ").at(-1)!.trim());
  return url.pathname + url.search; // opened on this server, whatever BASE_URL the links name
}

/** Asks for a link on the page in view, then follows it from the log, as someone would from their email. */
async function signIn(page: Page, email: string) {
  await page.getByLabel(/email/i).first().fill(email);
  await page.getByRole("button", { name: /send.*link/i }).first().click();
  await expect(page.getByText(/check your email/i)).toBeVisible();
  await expect.poll(() => linkFor(email), { timeout: 5_000 }).toContain("token=");
  await page.goto(linkFor(email));
}

// Fresh addresses every run, so repeated runs never meet the per-address limit on links.
const run = Date.now().toString(36);

test("a Host runs a Game while a guest follows along on their phone", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await signIn(host, `host-${run}@example.com`);

  await host.getByRole("button", { name: /new game/i }).click();
  await host.getByLabel(/name of the game/i).fill(`Smoke ${run}`);
  await host.getByRole("radio", { name: /players sign up on their phones/i }).check();
  await host.getByRole("button", { name: /create game/i }).click();
  await expect(host.getByRole("heading", { name: `Smoke ${run}` })).toBeVisible();
  for (const name of ["Ann", "Bob"]) {
    await host.getByLabel(/player's name/i).fill(name);
    await host.getByRole("button", { name: /add player/i }).click();
    await expect(host.getByText(name, { exact: true })).toBeVisible();
  }
  const gameUrl = host.url();

  // A guest scans the QR code: no sign-in needed to follow, then signs in to join as a Player.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(gameUrl); // a Game's own address, straight from the server
  const join = guest.getByRole("region", { name: /play in this game/i });
  await signIn(guest, `guest-${run}@example.com`);
  await expect(guest).toHaveURL(gameUrl); // back at the Game after signing in
  await join.getByLabel(/your name/i).fill("Cat");
  await join.getByRole("button", { name: /join as a player/i }).click();
  await expect(guest.getByText(/you're playing as cat/i)).toBeVisible();
  await expect(host.getByText("Cat", { exact: true })).toBeVisible(); // live, on the Host's phone

  await host.getByRole("button", { name: /start game/i }).click();
  const turn = host.getByRole("region", { name: /'s turn/i });
  await turn.getByPlaceholder(/what's in/i).fill("Socks");
  await turn.getByRole("button", { name: /open gift/i }).click();

  // The guest sees it live, without reloading.
  await expect(guest.getByRole("listitem", { name: "Socks" })).toBeVisible();
  await guest.getByLabel(/what's happening/i).fill("Nice socks!");
  await guest.getByRole("button", { name: /^post$/i }).click();
  await expect(host.getByRole("feed").getByText("Nice socks!")).toBeVisible();

  // The big screen, with its QR code.
  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto(`${gameUrl}/screen`);
  await expect(screen.getByRole("img", { name: /qr code/i })).toBeVisible();
  await expect(screen.getByRole("listitem", { name: "Socks" })).toBeVisible();
});

test("a reload anywhere in the app still works, and the build's files are cached", async ({ page, request }) => {
  await page.goto("/games/no-such-game");
  await expect(page.getByText(/there's no game at this link/i)).toBeVisible();

  const html = await (await request.get("/")).text();
  const script = html.match(/\/assets\/[^"]+\.js/)?.[0];
  expect(script).toBeTruthy();
  expect((await request.get(script!)).headers()["cache-control"]).toMatch(/immutable/);
});
