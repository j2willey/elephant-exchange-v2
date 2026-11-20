import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOfPage } from "../src/api.js";
import { browser, openApp, startServer } from "./harness.js";

afterEach(() => sessionStorage.clear());

/** A Game, with the server now handing out build "new". */
async function deployed() {
  const server = await startServer({ build: "new" });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ name: "Office swap", options: RECOMMENDED_OPTIONS });
  return { ...server, id };
}

describe("After a deploy, a page running the old app", () => {
  it("says a new version is ready, and reloads when asked", async () => {
    const { origin, id } = await deployed();
    const reload = vi.fn();
    openApp(browser(origin, { build: "old", reload }), `/games/${id}`);

    const notice = await screen.findByText(/a new version of elephant exchange is ready/i);
    expect(notice).toHaveTextContent(/a new version of elephant exchange is ready/i);
    expect(reload).not.toHaveBeenCalled(); // never by itself: someone may be typing
    await userEvent.click(screen.getByRole("button", { name: /^reload$/i }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("on the TV, reloads by itself, but only once for each new build", async () => {
    const { origin, id } = await deployed();
    const reload = vi.fn();
    openApp(browser(origin, { build: "old", reload }), `/games/${id}/screen`);
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(screen.queryByText(/a new version/i)).not.toBeInTheDocument();

    // The reload came back with the old app after all (a cache, say): no going round and round.
    cleanup();
    const again = vi.fn();
    openApp(browser(origin, { build: "old", reload: again }), `/games/${id}/screen`);
    await screen.findByRole("banner");
    await new Promise((r) => setTimeout(r, 100)); // time enough for an answer from the server to arrive
    expect(again).not.toHaveBeenCalled();
  });

  it("says nothing when it's already the newest", async () => {
    const { origin, id } = await deployed();
    openApp(browser(origin, { build: "new" }), `/games/${id}`);
    await screen.findByRole("tab", { name: /gifts/i });
    expect(screen.queryByText(/a new version/i)).not.toBeInTheDocument();
  });
});

describe("Which build a page is", () => {
  it("is the hash in its main script's name", () => {
    const doc = new DOMParser().parseFromString('<script type="module" crossorigin src="/assets/index-B7x_q2-a.js"></script>', "text/html");
    expect(buildOfPage(doc)).toBe("B7x_q2-a");
    expect(buildOfPage(new DOMParser().parseFromString('<script type="module" src="/src/main.tsx"></script>', "text/html"))).toBeUndefined();
  });
});
