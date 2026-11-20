import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { browser, drawInOrder, openApp, startServer } from "./harness.js";

/** WCAG's contrast ratio between two "#rrggbb" colors: the spec's own measure of readable. */
function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const cssVar = (name: string) => document.documentElement.style.getPropertyValue(name).trim();

/** A Game of the Host's Organization, themed as given. */
async function themed(theme: { color?: string; page?: string } = {}) {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const org = await host.createOrg("Lodge 22");
  await host.editOrg(org, theme);
  const id = await host.createGame({ name: "Holiday Party", orgId: org, options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3, rosterMode: "host" } });
  return { ...server, host, org, id, user: userEvent.setup() };
}

describe("A Game's Theme", () => {
  it("colors the Game's page for everyone following it", async () => {
    const { origin, id } = await themed({ color: "#0b3d91", page: "#f0f4ff" });

    openApp(browser(origin), `/games/${id}`);

    await waitFor(() => expect(cssVar("--brand")).toBe("#0b3d91"));
    expect(cssVar("--page")).toBe("#f0f4ff");
    expect(cssVar("--brand-ink")).toBe("#ffffff"); // white reads best on a dark blue
  });

  it("keeps text readable whatever the colors: a pale main color is darkened for text, and buttons get dark ink", async () => {
    const { origin, id } = await themed({ color: "#ffd700", page: "#1a1a2e" });

    openApp(browser(origin), `/games/${id}`);

    await waitFor(() => expect(cssVar("--brand")).toBe("#ffd700"));
    expect(contrast(cssVar("--brand-ink"), "#ffd700")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(cssVar("--brand-text"), "#ffffff")).toBeGreaterThanOrEqual(4.5); // on the white cards
    expect(contrast(cssVar("--page-heading"), "#1a1a2e")).toBeGreaterThanOrEqual(4.5); // on the dark page
  });

  it("shows the Organization's logo and background, on the phone and the big screen", async () => {
    const { origin, host, org, id } = await themed();
    await host.setOrgImage(org, "logo", new File([tinyPng], "logo.png", { type: "image/png" }));
    await host.setOrgImage(org, "background", new File([tinyPng], "bg.png", { type: "image/png" }));

    const phone = openApp(browser(origin), `/games/${id}`);
    const logo = await screen.findByRole("img", { name: /lodge 22 logo/i });
    expect(logo.getAttribute("src")).toMatch(new RegExp(`^/api/orgs/${org}/logo\\?v=`));
    expect(cssVar("--page-image")).toMatch(new RegExp(`url\\("/api/orgs/${org}/background\\?v=[^"]+"\\)`));
    phone.unmount();

    openApp(browser(origin), `/games/${id}/screen`);
    expect(await screen.findByRole("img", { name: /lodge 22 logo/i })).toBeInTheDocument();
  });

  it("changes on screens already open when the Organizer changes it", async () => {
    const { origin, host, org, id } = await themed({ color: "#0b3d91" });
    openApp(browser(origin), `/games/${id}/screen`);
    await waitFor(() => expect(cssVar("--brand")).toBe("#0b3d91"));

    await host.editOrg(org, { color: "#006400" });

    await waitFor(() => expect(cssVar("--brand")).toBe("#006400"));
  });

  it("goes back to the app's own look when leaving the Game", async () => {
    const { host, id, user } = await themed({ color: "#0b3d91" });
    openApp(host, `/games/${id}`);
    await waitFor(() => expect(cssVar("--brand")).toBe("#0b3d91"));

    await user.click(screen.getByRole("link", { name: /your games|home|elephant exchange/i }));

    await waitFor(() => expect(cssVar("--brand")).toBe(""));
  });
});

/** A 1×1 red PNG. */
const tinyPng = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);
