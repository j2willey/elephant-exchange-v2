import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const web = join(import.meta.dirname, "..");
const page = readFileSync(join(web, "index.html"), "utf8");
const meta = (property: string) => new RegExp(`<meta (?:property|name)="${property}" content="([^"]+)"`).exec(page)?.[1];
/** A file the page points to, as served from the site's root (the public folder). */
const served = (url: string) => existsSync(join(web, "public", new URL(url, "https://elephantexchange.app").pathname));

describe("The app's page, as a shared link and a browser tab show it", () => {
  it("gives a shared link a card: title, description and the badge picture, at an address that works from anywhere", () => {
    expect(meta("og:title")).toBe("Elephant Exchange");
    expect(meta("og:description")).toMatch(/white elephant/i);
    expect(meta("og:image")).toMatch(/^https:\/\/elephantexchange\.app\/og-image\.jpg$/);
    expect(served(meta("og:image")!)).toBe(true);
    expect(meta("twitter:card")).toBe("summary_large_image");
  });

  it("has the badge as its icon in a tab and on a phone's home screen", () => {
    const links = [...page.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)"[^>]* href="([^"]+)"/g)].map((m) => m[1]!);
    expect(links).toEqual(expect.arrayContaining(["/favicon.ico", "/apple-touch-icon.png", "/site.webmanifest"]));
    for (const link of links) expect(served(link)).toBe(true);
    const manifest = JSON.parse(readFileSync(join(web, "public/site.webmanifest"), "utf8")) as { icons: { src: string }[] };
    for (const icon of manifest.icons) expect(served(icon.src)).toBe(true);
  });
});
