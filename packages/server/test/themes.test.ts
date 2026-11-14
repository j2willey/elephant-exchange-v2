import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

type Theme = {
  organization: { id: string; name: string } | null;
  color: string | null;
  page: string | null;
  logoUrl: string | null;
  backgroundUrl: string | null;
  overrides: Record<"color" | "page" | "logo" | "background", boolean>;
};

const patch = (body: unknown, cookie?: string) => ({ ...post(body, cookie), method: "PATCH" });

async function setup() {
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer });
  const as = (email: string) => signIn(app, sent, email);
  const host = await as("host@example.com");
  const newOrg = async (cookie: string, name: string) => {
    const res = await app.request("/api/orgs", post({ name }, cookie));
    return { res, id: res.status === 201 ? ((await res.json()) as { id: string }).id : "" };
  };
  const newGame = async (cookie: string, orgId?: string) =>
    ((await (await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 }, ...(orgId ? { orgId } : {}) }, cookie))).json()) as { id: string }).id;
  const theme = async (gameId: string) => ((await (await app.request(`/api/games/${gameId}`)).json()) as { theme: Theme }).theme;
  const setOrg = (cookie: string, gameId: string, orgId: string | null) => app.request(`/api/games/${gameId}/org`, post({ orgId }, cookie));
  const editOrg = (cookie: string, orgId: string, body: unknown) => app.request(`/api/orgs/${orgId}`, patch(body, cookie));
  const editGameTheme = (cookie: string, gameId: string, body: unknown) => app.request(`/api/games/${gameId}/theme`, patch(body, cookie));
  return { app, as, host, newOrg, newGame, theme, setOrg, editOrg, editGameTheme };
}

describe("Organizations", () => {
  it("can be created by anyone signed in, who becomes its Organizer", async () => {
    const { app, as, newOrg } = await setup();
    expect((await app.request("/api/orgs", post({ name: "Troop 7" }))).status).toBe(401);
    const scout = await as("scout@example.com");

    const { res, id } = await newOrg(scout, "Troop 7");

    expect(res.status).toBe(201);
    expect(await (await app.request("/api/orgs", { headers: { cookie: scout } })).json()).toEqual([
      { id, name: "Troop 7", color: null, page: null, logoUrl: null, backgroundUrl: null },
    ]);
    expect(await (await app.request("/api/orgs", { headers: { cookie: await as("other@example.com") } })).json()).toEqual([]);
  });

  it("can be renamed and recolored only by its Organizer, with real colors", async () => {
    const { app, as, newOrg, editOrg } = await setup();
    const scout = await as("scout@example.com");
    const { id } = await newOrg(scout, "Troop 7");

    expect((await editOrg(await as("other@example.com"), id, { color: "#123456" })).status).toBe(403);
    expect((await editOrg(scout, id, { color: "red; background: url(x)" })).status).toBe(400);
    expect((await editOrg(scout, id, { name: "Lodge 22", color: "#C8102E", page: "#fff8f0" })).status).toBe(200);

    const [org] = (await (await app.request("/api/orgs", { headers: { cookie: scout } })).json()) as unknown[];
    expect(org).toMatchObject({ name: "Lodge 22", color: "#c8102e", page: "#fff8f0" });
  });
});

describe("A Game's Theme", () => {
  it("is the app's own until the Host picks an Organization, then that Organization's", async () => {
    const { host, newOrg, newGame, theme, setOrg, editOrg } = await setup();
    const { id: org } = await newOrg(host, "Lodge 22");
    await editOrg(host, org, { color: "#c8102e" });
    const game = await newGame(host);
    expect(await theme(game)).toEqual({
      organization: null,
      color: null,
      page: null,
      logoUrl: null,
      backgroundUrl: null,
      overrides: { color: false, page: false, logo: false, background: false },
    });

    expect((await setOrg(host, game, org)).status).toBe(204);

    expect(await theme(game)).toMatchObject({ organization: { id: org, name: "Lodge 22" }, color: "#c8102e" });
  });

  it("can be set when the Game is created, and changed or cleared later", async () => {
    const { host, newOrg, newGame, theme, setOrg, editOrg } = await setup();
    const { id: first } = await newOrg(host, "Lodge 22");
    const { id: second } = await newOrg(host, "Troop 7");
    await editOrg(host, second, { color: "#006400" });
    const game = await newGame(host, first);
    expect((await theme(game)).organization?.name).toBe("Lodge 22");

    await setOrg(host, game, second);
    expect(await theme(game)).toMatchObject({ organization: { name: "Troop 7" }, color: "#006400" });
    await setOrg(host, game, null);
    expect(await theme(game)).toMatchObject({ organization: null, color: null });
  });

  it("follows its Organization's Theme as the Organizer changes it", async () => {
    const { host, newOrg, newGame, theme, editOrg } = await setup();
    const { id: org } = await newOrg(host, "Lodge 22");
    const game = await newGame(host, org);
    await theme(game); // loaded, so the server holds a copy that must be brought up to date

    await editOrg(host, org, { page: "#fff8f0" });

    expect((await theme(game)).page).toBe("#fff8f0");
  });

  it("takes only an Organization its Host is the Organizer of, and only from the Host or a Co-host", async () => {
    const { as, host, newOrg, newGame, setOrg, app } = await setup();
    const { id: theirs } = await newOrg(await as("other@example.com"), "Not yours");
    const game = await newGame(host);
    expect((await setOrg(host, game, theirs)).status).toBe(403);
    expect((await setOrg(await as("gus@example.com"), game, null)).status).toBe(403);
    expect((await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 }, orgId: theirs }, host))).status).toBe(403);
  });

  it("can be overridden for one Game, part by part, falling back to the Organization's when cleared", async () => {
    const { as, host, newOrg, newGame, theme, editOrg, editGameTheme } = await setup();
    const { id: org } = await newOrg(host, "Lodge 22");
    await editOrg(host, org, { color: "#c8102e", page: "#ffffff" });
    const game = await newGame(host, org);

    expect((await editGameTheme(await as("gus@example.com"), game, { color: "#0b6623" })).status).toBe(403);
    expect((await editGameTheme(host, game, { color: "nope" })).status).toBe(400);
    expect((await editGameTheme(host, game, { color: "#0B6623" })).status).toBe(200);
    expect(await theme(game)).toMatchObject({ color: "#0b6623", page: "#ffffff" });
    // Says which parts are the Game's own, so the Host can be offered to hand those back.
    expect((await theme(game)).overrides).toEqual({ color: true, page: false, logo: false, background: false });

    await editOrg(host, org, { color: "#000080" });
    expect((await theme(game)).color).toBe("#0b6623"); // the Game's own still wins

    await editGameTheme(host, game, { color: null });
    expect((await theme(game)).color).toBe("#000080");
  });
});
