import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { browser, openApp, startServer } from "./harness.js";

async function askForLink(email: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/email/i), email);
  await user.click(screen.getByRole("button", { name: /send.*link/i }));
}

describe("Signing in", () => {
  it("asks a signed-out visitor for their email, then tells them to check it", async () => {
    const { origin, sent } = await startServer();
    openApp(browser(origin), "/login");

    await askForLink("ann@example.com");

    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(sent.map((m) => m.email)).toEqual(["ann@example.com"]);
  });

  it("says to look in the spam folder, and lets them send the link again", async () => {
    const { origin, sent } = await startServer();
    openApp(browser(origin), "/login");
    expect(await screen.findByText(/look in your spam folder/i)).toBeInTheDocument(); // before asking
    await askForLink("ann@example.com");

    expect(await screen.findByText(/spam or junk folder/i)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /send it again/i }));
    expect(screen.getByLabelText(/email address/i)).toHaveValue("ann@example.com"); // kept, to fix or resend
    await userEvent.setup().click(screen.getByRole("button", { name: /send me a sign-in link/i }));
    await screen.findByText(/spam or junk folder/i);
    expect(sent.map((m) => m.email)).toEqual(["ann@example.com", "ann@example.com"]);
  });

  it("signs the Host in from the emailed link, and they stay signed in", async () => {
    const { origin, linkFor } = await startServer();
    const ann = browser(origin);
    openApp(ann, "/login");
    await askForLink("ann@example.com");
    await screen.findByText(/check your email/i);

    const user = userEvent.setup();
    const { unmount } = openApp(ann, linkFor("ann@example.com"));
    await user.click(await screen.findByRole("button", { name: /show my email/i }));
    expect(screen.getByText(/signed in as ann@example\.com/i)).toBeInTheDocument();
    unmount();

    openApp(ann); // reloading the app
    // Still signed in; the address isn't on the page until asked for, so it's never in a screenshot.
    expect(await screen.findByRole("button", { name: /show my email/i })).toBeInTheDocument();
    expect(screen.queryByText(/signed in as ann@example\.com/i)).not.toBeInTheDocument();
  });

  it("says when a link has already been used, and offers to send a new one", async () => {
    const { origin, linkFor } = await startServer();
    const ann = browser(origin);
    openApp(ann, "/login");
    await askForLink("ann@example.com");
    await screen.findByText(/check your email/i);
    const link = linkFor("ann@example.com");
    const first = openApp(ann, link);
    await screen.findByRole("button", { name: /show my email/i });
    first.unmount();

    openApp(browser(origin), link); // someone opening the same link again, on another phone

    expect(await screen.findByText(/link has already been used or has expired/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it("treats a link with no token as one that doesn't work", async () => {
    const { origin } = await startServer();
    openApp(browser(origin), "/sign-in");
    expect(await screen.findByText(/link has already been used or has expired/i)).toBeInTheDocument();
  });

  it("explains when too many links have been asked for", async () => {
    const { origin } = await startServer();
    for (let i = 0; i < 3; i++) await browser(origin).requestLink("ann@example.com");
    openApp(browser(origin), "/login");

    await askForLink("ann@example.com");

    expect(await screen.findByText(/too many/i)).toBeInTheDocument();
  });

  it("signs out, back to the front page, with Sign in at the top", async () => {
    const { origin, linkFor } = await startServer();
    const ann = browser(origin);
    await ann.requestLink("ann@example.com");
    openApp(ann, linkFor("ann@example.com"));
    await screen.findByRole("button", { name: /show my email/i });

    await userEvent.setup().click(screen.getByRole("button", { name: /sign out/i }));

    expect(await screen.findByRole("region", { name: /what it is/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^sign in$/i })).toHaveAttribute("href", "/login");
    expect(await ann.session()).toBeUndefined();
  });
});

describe("Signing out", () => {
  it("is at the top of the page for someone signed in, and signs them out", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    openApp(host, "/guide");

    await userEvent.setup().click(await screen.findByRole("button", { name: /sign out/i }));

    expect(await screen.findByRole("region", { name: /what it is/i })).toBeInTheDocument(); // the front page
    expect(await host.session()).toBeUndefined();
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });

  it("isn't offered inside a Game, where a guest might tap it by mistake", async () => {
    const { signedIn } = await startServer();
    const host = await signedIn("host@example.com");
    const id = await host.createGame({ name: "Acme Holiday Party", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    openApp(host, `/games/${id}`);
    await screen.findByText(/acme holiday party/i);

    expect(screen.queryByRole("button", { name: /^sign out$/i })).not.toBeInTheDocument();
  });

  it("isn't there for someone signed out", async () => {
    const { origin } = await startServer();
    openApp(browser(origin), "/guide");
    await screen.findByRole("heading", { name: /host's guide/i });

    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });
});
