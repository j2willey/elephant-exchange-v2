import { cleanup, screen, within } from "@testing-library/react";
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

describe("Which commit is running", () => {
  it("is on the System page and the Admin page, linked to the commit on GitHub", async () => {
    const sha = "5235227f0e8b1c2d3a4f5e6d7c8b9a0f1e2d3c4b";
    const server = await startServer({ adminEmails: ["boss@example.org"], commit: sha });
    const admin = await server.signedIn("boss@example.org");

    openApp(admin, "/admin/system");
    const onSystem = await screen.findByRole("link", { name: "5235227" });
    expect(onSystem).toHaveAttribute("href", `https://github.com/j2willey/elephant-exchange-v2/commit/${sha}`);
    cleanup();

    openApp(admin, "/admin");
    const onAdmin = await screen.findByRole("link", { name: "5235227" });
    expect(onAdmin.closest("p")).toHaveTextContent(/running 5235227/i);
  });
});
