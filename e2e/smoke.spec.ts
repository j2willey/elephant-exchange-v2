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
  await page.getByRole("button", { name: /send.*link|email me a link/i }).first().click();
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

  // A new Host first sees Jim's tip note; ticking it means the next New Game goes straight to the form.
  await host.getByRole("button", { name: /new game/i }).click();
  const note = host.getByRole("dialog", { name: /a note from jim/i });
  await expect(note.getByRole("link", { name: /leave a tip/i })).toBeVisible();
  await note.getByRole("checkbox", { name: /read and considered/i }).check();
  await note.getByRole("button", { name: /continue/i }).click();
  await host.getByLabel(/name of the game/i).fill(`Smoke ${run}`);
  await host.getByRole("button", { name: /customize settings/i }).click();
  await host.getByRole("radio", { name: /players sign up on their phones/i }).check();
  await host.getByRole("button", { name: /create the game/i }).click();
  await expect(host.getByRole("heading", { name: `Smoke ${run}` })).toBeVisible();
  for (const name of ["Ann", "Bob"]) {
    await host.getByLabel(/player's name/i).fill(name);
    await host.getByRole("button", { name: /add player/i }).click();
    await expect(host.getByText(name, { exact: true })).toBeVisible();
  }
  const gameUrl = host.url();

  // A guest scans the QR code: the welcome screen asks their name, email and whether they brought a gift, and the
  // emailed link brings them back to the Game as a Player (ADR 0007).
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(gameUrl); // a Game's own address, straight from the server
  const join = guest.getByRole("form", { name: /join this game/i });
  await join.getByLabel(/your name/i).fill("Cat");
  await join.getByRole("checkbox", { name: /i brought a gift/i }).check();
  await signIn(guest, `guest-${run}@example.com`);
  await expect(guest).toHaveURL(gameUrl); // back at the Game, the address tidied once they've joined
  await guest.getByRole("tab", { name: /^you$/i }).click();
  await expect(guest.getByText(/you're playing as cat/i)).toBeVisible();
  await expect(host.getByText("Cat", { exact: true })).toBeVisible(); // live, on the Host's phone

  await host.getByRole("button", { name: /start game/i }).click();
  const turn = host.getByRole("region", { name: /'s turn/i });
  await turn.getByPlaceholder(/what's in/i).fill("Socks");
  await turn.getByRole("button", { name: /open gift/i }).click();

  // The guest sees it live, without reloading.
  await guest.getByRole("tab", { name: /gifts/i }).click();
  await expect(guest.getByRole("listitem", { name: "Socks" })).toBeVisible();
  await guest.getByRole("tab", { name: /^post/i }).click();
  await guest.getByLabel(/what's happening/i).fill("Nice socks!");
  await guest.getByRole("button", { name: /^post$/i }).click();
  await expect(host.getByRole("feed").getByText("Nice socks!")).toBeVisible();

  // A camera photo, stored sideways with an orientation tag and GPS: the phone turns it upright and shrinks it
  // (at most 1280 px, under 200 KB) before sending, and the server keeps a copy without the EXIF, which the Host
  // sees live.
  await guest.getByRole("tab", { name: /^post/i }).click();
  await guest.getByLabel(/add a photo/i).setInputFiles("e2e/fixtures/sideways-camera-photo.jpg");
  await guest.getByLabel(/what's happening/i).fill("Group photo");
  const [upload] = await Promise.all([
    guest.waitForRequest((r) => r.method() === "POST" && /\/posts$/.test(r.url())),
    guest.getByRole("button", { name: /^post$/i }).click(),
  ]);
  await upload.response();
  expect((await upload.sizes()).requestBodySize).toBeLessThan(200_000 + 2_000); // the photo, plus the form's few fields
  const photo = host.getByRole("feed").getByRole("img", { name: /photo from cat/i });
  await expect(photo).toBeVisible();
  // The Feed shows its small copy (at most 640 px), still upright; the full Photo keeps all the phone sent.
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([480, 640]);
  const full = (await photo.getAttribute("src"))!.replace("/photo-small.jpg", "/photo.jpg");
  const fullSize = await host.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  }, full);
  expect(fullSize).toEqual([960, 1280]);

  // The Host can keep them all, from the Game's settings.
  await host.getByRole("link", { name: /settings/i }).click();
  const [album] = await Promise.all([host.waitForEvent("download"), host.getByRole("link", { name: /download all the photos/i }).click()]);
  expect(album.suggestedFilename()).toMatch(/-photos\.zip$/);
  await host.getByRole("link", { name: /back to the game/i }).click();

  // The big screen, with its QR code.
  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto(`${gameUrl}/screen`);
  await expect(screen.getByRole("img", { name: /qr code/i })).toBeVisible();
  await expect(screen.getByRole("listitem", { name: "Socks" })).toBeVisible();
  const latest = screen.getByRole("feed", { name: /latest posts/i });
  await expect(latest.getByText("Nice socks!")).toBeVisible();
  await expect(latest.getByRole("img", { name: /photo from cat/i })).toBeVisible();
  if (process.env["SMOKE_SCREENSHOT"]) await screen.screenshot({ path: process.env["SMOKE_SCREENSHOT"], fullPage: true });

  // The end, and the Worst Gift Vote: the guest votes on their phone, the big screen counts it live.
  await host.getByRole("link", { name: /settings/i }).click();
  await host.getByRole("button", { name: /end the game/i }).click();
  await host.getByRole("button", { name: /yes, end it now/i }).click();
  const vote = host.getByRole("region", { name: /worst gift vote/i });
  await vote.getByRole("button", { name: /start the vote/i }).click();
  await guest.getByRole("list", { name: /vote for the worst gift/i }).getByRole("button", { name: /^socks/i }).click();
  await expect(screen.getByRole("list", { name: /votes so far/i }).getByRole("listitem", { name: "Socks" })).toContainText("1 vote");
  if (process.env["SMOKE_SCREENSHOT"]) await screen.screenshot({ path: process.env["SMOKE_SCREENSHOT"].replace(/\.png$/, "-vote.png"), fullPage: true });
  await vote.getByRole("radio", { name: /parade/i }).click();
  await expect(screen.getByRole("list", { name: /gift parade/i })).toBeVisible();
  await vote.getByRole("button", { name: /close the vote/i }).click();
  await expect(screen.getByText(/worst gift: socks/i)).toBeVisible();
  if (process.env["SMOKE_SCREENSHOT"]) await screen.screenshot({ path: process.env["SMOKE_SCREENSHOT"].replace(/\.png$/, "-reveal.png"), fullPage: true });
});

test("a reload anywhere in the app still works, and the build's files are cached", async ({ page, request }) => {
  await page.goto("/games/no-such-game");
  await expect(page.getByText(/there's no game at this link/i)).toBeVisible();

  const html = await (await request.get("/")).text();
  const script = html.match(/\/assets\/[^"]+\.js/)?.[0];
  expect(script).toBeTruthy();
  expect((await request.get(script!)).headers()["cache-control"]).toMatch(/immutable/);
});

test("an Organizer themes their Organization, and a Game in it shows that Theme", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await signIn(page, `organizer-${run}@example.com`);

  // Folded away under Your Games, since most Hosts never need one.
  await page.getByText(/organizations \(optional\)/i).click();
  const orgs = page.getByRole("region", { name: /your organizations/i });
  await orgs.getByLabel(/new organization/i).fill(`Lodge ${run}`);
  await orgs.getByRole("button", { name: /create/i }).click();
  await page.getByLabel(/main color/i).fill("#0b3d91");
  await page.getByLabel(/page color/i).fill("#ffd700");
  await page.getByRole("button", { name: /save colors/i }).click();
  await page.getByLabel(/^logo/i).setInputFiles("e2e/fixtures/sideways-camera-photo.jpg");
  await expect(page.getByRole("img", { name: new RegExp(`lodge ${run} logo`, "i") })).toBeVisible();

  await page.getByRole("link", { name: /back to your games/i }).click();
  await page.getByRole("button", { name: /new game/i }).click();
  // A new Organizer: Jim's tip note comes first, once.
  await page.getByRole("dialog", { name: /a note from jim/i }).getByRole("button", { name: /continue/i }).click();
  await page.getByLabel(/^organization$/i).selectOption({ label: `Lodge ${run}` });
  await page.getByRole("button", { name: /use recommended settings/i }).click();
  await expect(page.getByRole("img", { name: new RegExp(`lodge ${run} logo`, "i") })).toBeVisible();

  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto(`${page.url()}/screen`);
  await expect(screen.getByRole("img", { name: new RegExp(`lodge ${run} logo`, "i") })).toBeVisible();
  // The page really is drawn in the Theme's colors.
  await expect.poll(() => screen.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 215, 0)");
  if (process.env["SMOKE_SCREENSHOT"]) await screen.screenshot({ path: process.env["SMOKE_SCREENSHOT"].replace(/\.png$/, "-theme.png") });
});
