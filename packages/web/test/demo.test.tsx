import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { openApp, startServer } from "./harness.js";

const rosterNames = () => within(screen.getByRole("list", { name: /players/i })).getAllByRole("listitem").map((li) => li.querySelector("[data-name]")?.textContent);

describe("A demo Game", () => {
  it("is created with as many made-up Players as asked for, ready to start", async () => {
    const { signedIn } = await startServer();
    openApp(await signedIn("host@example.com"));
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /try a demo game/i }));
    const players = screen.getByLabelText(/how many players/i);
    await user.clear(players);
    await user.type(players, "6");
    await user.click(screen.getByRole("button", { name: /create demo game/i }));

    expect(await screen.findByRole("heading", { name: /demo game/i })).toBeInTheDocument();
    await screen.findByRole("button", { name: /start game/i });
    await expect.poll(() => rosterNames().length).toBe(6);
    expect(new Set(rosterNames()).size).toBe(6); // all different
    expect(screen.getByRole("button", { name: /start game/i })).toBeEnabled();
  });

  it("asks for at least 2 Players", async () => {
    const { signedIn } = await startServer();
    openApp(await signedIn("host@example.com"));
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /try a demo game/i }));
    const players = screen.getByLabelText(/how many players/i);
    expect(players).toHaveAttribute("min", "2");
    expect(players).toHaveAttribute("max", "40");
  });
});
