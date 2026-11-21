import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { drawInOrder, openApp, startServer } from "./harness.js";

/** A Game in play, its big screen open in the Host's own browser (as it usually is, on a laptop at the party). */
async function onTheBigScreen() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
  for (const name of ["Ann", "Bob"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
  await host.command(id, { type: "StartGame" });
  const gus = await server.signedIn("gus@example.com");
  openApp(host, `/games/${id}/screen`);
  await screen.findByText(/up now/i);
  return { ...server, host, gus, id };
}

const latest = () => screen.findByRole("feed", { name: /latest posts/i });
const shown = async () => within(await latest()).queryAllByRole("article").map((a) => a.textContent);

describe("Posts on the big screen", () => {
  it("shows Posts as they arrive, newest first", async () => {
    const { gus, id } = await onTheBigScreen();
    expect(await shown()).toEqual([]);

    await gus.post(id, { text: "Hello, room!", name: "Gus" });
    await gus.post(id, { text: "Nice socks", name: "Gus" });

    await waitFor(async () => expect(await shown()).toEqual([expect.stringMatching(/gus.*nice socks/i), expect.stringMatching(/gus.*hello, room!/i)]));
  });

  it("shows only what everyone may see, though the Host's browser is the one showing it", async () => {
    const { host, gus, id } = await onTheBigScreen();
    await host.setModeration(id, "approval");
    await gus.post(id, { text: "Waiting for approval", name: "Gus" });
    await gus.post(id, { text: "Also waiting", name: "Gus" });
    const [second, first] = await host.posts(id);

    await host.setPostStatus(id, first!.id, "visible");
    await waitFor(async () => expect(await shown()).toEqual([expect.stringMatching(/waiting for approval/i)]));

    await host.setPostStatus(id, first!.id, "hidden");
    await waitFor(async () => expect(await shown()).toEqual([]));
    expect(second!.status).toBe("pending");
  });

  it("shows each Post's Reactions as they come in, with no way to react from the screen", async () => {
    const { gus, id } = await onTheBigScreen();
    await gus.post(id, { text: "Nice socks", name: "Gus" });
    const [p] = await gus.posts(id);
    await gus.react(id, p!.id, "😂", true);

    await waitFor(async () => expect(within(await latest()).getByLabelText(/funny: 1/i)).toBeInTheDocument());
    expect(within(await latest()).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a reply with the Post it answers quoted above it", async () => {
    const { gus, id } = await onTheBigScreen();
    await gus.post(id, { text: "Stole the lamp!", name: "Gus" });
    const [lamp] = await gus.posts(id);
    await gus.post(id, { text: "Third time!", name: "Gus", replyTo: lamp!.id });

    await waitFor(async () => expect((await shown())[0]).toMatch(/gus: stole the lamp!.*third time!/i));
  });

  it("keeps to the newest six, so the room can read them", async () => {
    const { host, gus, id } = await onTheBigScreen();
    await host.setGameOptions(id, { postsPerMinute: 0 }); // eight Posts at once, which the Feed limit would stop
    for (let n = 1; n <= 8; n++) await gus.post(id, { text: `Post ${n}`, name: "Gus" });

    await waitFor(async () => expect(await shown()).toHaveLength(6));
    const texts = (await shown()).join(" ");
    expect(texts).toMatch(/post 8/i);
    expect(texts).toMatch(/post 3/i);
    expect(texts).not.toMatch(/post 2\b/i);
  });

  it("offers no way to post or moderate: the screen only watches", async () => {
    await onTheBigScreen();
    await latest();
    expect(screen.queryByRole("form", { name: /post to the chat/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /hide/i })).not.toBeInTheDocument();
  });
});
