import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(join(import.meta.dirname, "../index.html"), "utf8");
const meta = (property: string) => new RegExp(`<meta property="${property}" content="([^"]*)"`).exec(page)?.[1];

describe("The link card (what LinkedIn, Facebook and others show when the link is shared)", () => {
  it("has a title, a description and a 1200 × 630 image", () => {
    expect(meta("og:title")).toBe("Elephant Exchange");
    expect(meta("og:description")).toMatch(/White Elephant/);
    expect(meta("og:image")).toBe("https://elephantexchange.app/og-image.jpg");
    expect([meta("og:image:width"), meta("og:image:height")]).toEqual(["1200", "630"]);
  });

  it("leaves the address to the link that was shared, so /try?ref=linkedin isn't sent to the front page instead", () => {
    // Every page of the app is this one file: an og:url here would name the front page for all of them.
    expect(meta("og:url")).toBeUndefined();
  });
});
