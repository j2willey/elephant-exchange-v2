import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { openApp, startServer } from "./harness.js";

const note = () => screen.findByRole("dialog", { name: /a note from jim/i });

describe("Jim's tip note on New Game", () => {
  it("shows before the New Game form, with the tip link, until the Host ticks that they've read and considered it", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com", { tipNoteRead: false });
    const user = userEvent.setup();
    openApp(host);

    await user.click(await screen.findByRole("button", { name: /new game/i }));
    let dialog = await note();
    expect(dialog).toHaveTextContent(/built elephant exchange for my own holiday party.*no strings/i);
    expect(within(dialog).getByRole("link", { name: /leave a tip/i })).toHaveAttribute("href", "https://ko-fi.com/jimwilley");

    // Not ticked: on to the form, but the note comes back next time.
    await user.click(within(dialog).getByRole("button", { name: /continue/i }));
    expect(await screen.findByLabelText(/name of the game/i)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect((await host.session())!.tipNoteRead).toBe(false);

    cleanup();
    openApp(host); // the home page again, as after a reload
    await user.click(await screen.findByRole("button", { name: /new game/i }));
    dialog = await note();
    await user.click(within(dialog).getByRole("checkbox", { name: /i've read and considered this/i }));
    await user.click(within(dialog).getByRole("button", { name: /continue/i }));
    expect(await screen.findByLabelText(/name of the game/i)).toBeInTheDocument();
    expect((await host.session())!.tipNoteRead).toBe(true);
  });

  it("goes straight to the New Game form once it's been read, on any device", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com", { tipNoteRead: false });
    await host.markTipNoteRead();
    const laptop = await signedIn("host@example.com", { tipNoteRead: false });
    const user = userEvent.setup();
    openApp(laptop);

    await user.click(await screen.findByRole("button", { name: /new game/i }));

    expect(await screen.findByLabelText(/name of the game/i)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("can be closed without starting a Game", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com", { tipNoteRead: false });
    const user = userEvent.setup();
    openApp(host);

    await user.click(await screen.findByRole("button", { name: /new game/i }));
    await user.click(within(await note()).getByRole("button", { name: /not now/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/name of the game/i)).not.toBeInTheDocument();
  });
});
