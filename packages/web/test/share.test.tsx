import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browser, drawInOrder, onTab, openApp, startServer } from "./harness.js";

const jpeg = Uint8Array.from(
  atob(
    "/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAeACgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAQG/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AsAM2vAAAAAAAAAAf/9k=",
  ),
  (c) => c.charCodeAt(0),
);

/** Gus posted a line and a Photo; someone just following the Game, not signed in, has the Feed open. */
async function following() {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ name: "Office swap", options: { ...RECOMMENDED_OPTIONS, rosterMode: "host" } });
  const gus = await server.signedIn("gus@example.com");
  await gus.post(id, { text: "Bob's face when he opened the singing fish", name: "Gus" });
  await gus.post(id, { text: "", name: "Gus", photo: new File([jpeg], "fish.jpg", { type: "image/jpeg" }) });
  // The page fetches the Photo by its own address, as a browser would from the server.
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    real(typeof input === "string" && input.startsWith("/") ? new URL(input, server.origin) : input, init),
  );
  const user = userEvent.setup();
  openApp(browser(server.origin), `/games/${id}`);
  await onTab(/feed/i);
  const feed = await screen.findByRole("feed", { name: /feed/i });
  await within(feed).findByRole("img", { name: /photo from gus/i });
  return { ...server, id, user, feed };
}

const shareButtons = (feed: HTMLElement) => within(feed).getAllByRole("button", { name: /share gus's post/i });

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(navigator, { share: undefined, canShare: undefined });
});

describe("Sharing a Post outside the party", () => {
  it("opens the phone's share menu with what was said, who said it and a link to the app, not to the Game", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { share });
    const { id, user, feed } = await following();

    await user.click(shareButtons(feed).find((b) => b.closest("article")!.textContent!.includes("singing fish"))!);

    expect(share).toHaveBeenCalledOnce();
    const sent = share.mock.calls[0]![0] as ShareData;
    expect(sent.text).toMatch(/“Bob's face when he opened the singing fish” \(Gus\), at Office swap\..*Elephant Exchange/);
    expect(sent.url).toBe(`${window.location.origin}/?ref=share`);
    expect(JSON.stringify(sent)).not.toContain(id); // a funny moment shared doesn't open up the whole party
  });

  it("sends the Photo itself when the phone can share files", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { share, canShare: () => true });
    const { user, feed } = await following();

    await user.click(shareButtons(feed).find((b) => b.closest("article")!.querySelector("img"))!);

    await waitFor(() => expect(share).toHaveBeenCalledOnce());
    const sent = share.mock.calls[0]![0] as ShareData;
    expect(sent.files).toHaveLength(1);
    expect(sent.files![0]!.type).toMatch(/^image\//);
    expect(sent.text).toMatch(/a photo from gus.*\/\?ref=share$/i); // the link in the words, as some apps drop it
  });

  it("copies it to paste where a browser can't share, and says so", async () => {
    const { user, feed } = await following();

    await user.click(shareButtons(feed)[0]!);

    expect(await within(feed).findByRole("status")).toHaveTextContent(/copied/i);
    expect(await navigator.clipboard.readText()).toMatch(/Elephant Exchange: .*\/\?ref=share$/);
  });

  it("does nothing more if they change their mind in the share menu", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("Share canceled", "AbortError"));
    Object.assign(navigator, { share });
    const { user, feed } = await following();

    await user.click(shareButtons(feed)[0]!);

    await waitFor(() => expect(share).toHaveBeenCalledOnce());
    expect(within(feed).queryByRole("status")).not.toBeInTheDocument();
  });
});
