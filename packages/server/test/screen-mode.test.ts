import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { capturingMailer, post, signIn } from "./support.js";

/** A Game, its Host, and a way to switch what its big screen shows. */
async function aGame() {
  const { sent, mailer } = capturingMailer();
  const { app } = createServer({ dbPath: ":memory:", mailer });
  const host = await signIn(app, sent, "host@example.com");
  const { id } = (await (await app.request("/api/games", post({ settings: { activeSlots: 1, maxSteals: 3 } }, host))).json()) as { id: string };
  const game = async () => (await (await app.request(`/api/games/${id}`)).json()) as { screen: string };
  const setScreen = (cookie: string | undefined, mode: string, gameId = id) => app.request(`/api/games/${gameId}/screen`, post({ mode }, cookie));
  const as = (email: string) => signIn(app, sent, email);
  return { id, host, game, setScreen, as };
}

describe("What the big screen shows", () => {
  it("is the Gifts until the Host switches it", async () => {
    const { game } = await aGame();
    expect((await game()).screen).toBe("gifts");
  });

  it("switches to the rules, the join code, the catalog and back, for everyone watching", async () => {
    const { host, game, setScreen } = await aGame();
    for (const mode of ["rules", "qr", "catalog", "gifts"]) {
      expect((await setScreen(host, mode)).status).toBe(204);
      expect((await game()).screen).toBe(mode);
    }
  });

  it("is switched only by the Host or a Co-host", async () => {
    const { game, setScreen, as } = await aGame();
    expect((await setScreen(undefined, "rules")).status).toBe(401);
    expect((await setScreen(await as("gus@example.com"), "rules")).status).toBe(403);
    expect((await game()).screen).toBe("gifts");
  });

  it("takes only the modes there are, for a Game that exists", async () => {
    const { host, setScreen } = await aGame();
    expect((await setScreen(host, "fireworks")).status).toBe(400);
    expect((await setScreen(host, "rules", "nope")).status).toBe(404);
  });
});
