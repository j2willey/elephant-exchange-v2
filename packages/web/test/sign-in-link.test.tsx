import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { browser, openApp, startServer } from "./harness.js";

describe("Signing back in from the top of the page", () => {
  it("offers Sign in to someone signed out, which asks for their email", async () => {
    const { origin, sent } = await startServer();
    openApp(browser(origin));
    const user = userEvent.setup();

    await user.click(await screen.findByRole("link", { name: /^sign in$/i }));
    await user.type(await screen.findByLabelText(/email address/i), "ann@example.com");
    await user.click(screen.getByRole("button", { name: /send me a sign-in link/i }));

    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(sent.map((m) => m.email)).toEqual(["ann@example.com"]);
  });

  it("offers it on the app's other pages too, such as the Host's Guide", async () => {
    const { origin } = await startServer();
    openApp(browser(origin), "/guide");

    expect(await screen.findByRole("link", { name: /^sign in$/i })).toBeInTheDocument();
  });

  it("offers Sign out, not Sign in, to someone signed in", async () => {
    const server = await startServer();
    openApp(await server.signedIn("ann@example.com"));

    expect(await screen.findByRole("button", { name: /sign out/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^sign in$/i })).not.toBeInTheDocument();
  });
});
