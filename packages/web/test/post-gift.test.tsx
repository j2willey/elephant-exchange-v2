import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { drawInOrder, onTab, openApp, startServer } from "./harness.js";

/** Ann opened a Mug; Gus posted without saying which Gift. */
async function underway() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ name: "Troop swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
  for (const name of ["Ann", "Bob"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
  await host.command(id, { type: "StartGame" });
  await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Mug" });
  const gus = await server.signedIn("gus@example.com");
  await gus.post(id, { text: "Ann's face!", name: "Gus" });
  return { ...server, host, gus, id, user: userEvent.setup() };
}

const gusPost = async () => within(await screen.findByRole("feed", { name: /feed/i })).findByRole("article", { name: /gus/i });

describe("Attaching a Post to a Gift from the Feed", () => {
  it("lets the poster pick the Gift afterwards, and it then shows under that Gift", async () => {
    const { gus, id, user } = await underway();
    openApp(gus, `/games/${id}`);
    await onTab(/^feed/i);

    await user.click(await within(await gusPost()).findByRole("button", { name: /attach to a gift/i }));
    const form = within(await gusPost()).getByRole("form", { name: /which gift/i });
    await user.selectOptions(within(form).getByLabelText(/which gift/i), "Mug");
    await user.click(within(form).getByRole("button", { name: /save/i }));

    await waitFor(async () => expect(await gusPost()).toHaveTextContent(/about mug/i));
    expect(within(await gusPost()).getByRole("button", { name: /change gift/i })).toBeInTheDocument();
    await onTab(/gifts/i);
    await waitFor(() => expect(screen.getByRole("listitem", { name: "Mug" })).toHaveTextContent(/ann's face!/i));
  });

  it("lets the Host attach anyone's Post", async () => {
    const { host, id, user } = await underway();
    openApp(host, `/games/${id}`);

    await user.click(await within(await gusPost()).findByRole("button", { name: /attach to a gift/i }));
    const form = within(await gusPost()).getByRole("form", { name: /which gift/i });
    await user.selectOptions(within(form).getByLabelText(/which gift/i), "Mug");
    await user.click(within(form).getByRole("button", { name: /save/i }));
    await waitFor(async () => expect((await host.posts(id))[0]!.giftId).toBe("g1"));
  });

  it("isn't offered on someone else's Post", async () => {
    const { signedIn, id } = await underway();
    openApp(await signedIn("dot@example.com"), `/games/${id}`);
    await onTab(/^feed/i);
    await gusPost();
    expect(screen.queryByRole("button", { name: /attach to a gift/i })).not.toBeInTheDocument();
  });
});
