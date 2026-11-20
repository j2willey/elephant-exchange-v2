import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { openApp, startServer } from "./harness.js";

const card = () => screen.findByRole("region", { name: /^co-hosts$/i });

describe("Co-hosts in a Game's settings", () => {
  it("lets the Host add a Co-host by email, who then sees the Game on their home screen, and remove them", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const id = await host.createGame({ name: "Office swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    const user = userEvent.setup();

    const page = openApp(host, `/games/${id}/settings`);
    const box = await card();
    expect(await within(box).findByText(/none yet/i)).toBeInTheDocument();
    await user.type(within(box).getByLabelText(/add a co-host by email/i), "Bob@Example.com");
    await user.click(within(box).getByRole("button", { name: /^add$/i }));
    expect(await within(box).findByRole("list", { name: /co-hosts of this game/i })).toHaveTextContent("bob@example.com");
    page.unmount();

    const bob = await signedIn("bob@example.com");
    const bobs = openApp(bob);
    expect(await screen.findByRole("link", { name: /office swap/i })).toBeInTheDocument();
    bobs.unmount();

    openApp(host, `/games/${id}/settings`);
    const again = await card();
    await user.click(await within(again).findByRole("button", { name: /remove bob@example.com/i }));
    await waitFor(() => expect(within(again).getByText(/none yet/i)).toBeInTheDocument());
    expect(await bob.cohosts(id).catch(() => "refused")).toBe("refused");
  });

  it("shows a Co-host who else co-hosts, without the Host's controls", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const id = await host.createGame({ name: "Office swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    await host.addCohost(id, "bob@example.com");
    const bob = await signedIn("bob@example.com");

    openApp(bob, `/games/${id}/settings`);
    const box = await card();
    expect(await within(box).findByRole("list", { name: /co-hosts of this game/i })).toHaveTextContent("bob@example.com");
    expect(within(box).queryByLabelText(/add a co-host/i)).toBeNull();
    expect(within(box).queryByRole("button", { name: /remove/i })).toBeNull();
  });
});
