import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { openApp, startServer } from "./harness.js";

describe("The admin's System page", () => {
  it("is reached from Admin, and shows each server's health with what's wrong in words", async () => {
    const server = await startServer({ adminEmails: ["boss@example.org"], overload: { maxScreens: 500 } });
    const admin = await server.signedIn("boss@example.org");
    const user = userEvent.setup();
    openApp(admin, "/admin");

    await user.click(await screen.findByRole("link", { name: /system/i }));

    const row = await screen.findByRole("row", { name: /server a/i });
    expect(within(row).getByText(/^⚠️ up$/i)).toBeInTheDocument(); // up, with a warning
    expect(within(row).getByText(/no backup found/i)).toBeInTheDocument(); // the test server keeps none
    expect(within(row).getByText(/of 500/)).toBeInTheDocument(); // its screens, against the limit
  });

  it("is nothing to anyone else", async () => {
    const server = await startServer({ adminEmails: ["boss@example.org"] });
    openApp(await server.signedIn("ann@example.org"), "/admin/system");

    expect(await screen.findByText(/nothing here/i)).toBeInTheDocument();
  });
});
