import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { browser, clock, drawInOrder, openApp, startServer } from "./harness.js";

/** A started Game, Ann up first, then Bob; `turnSeconds` left out takes the usual 60. */
async function started(turnSeconds?: number) {
  const server = await startServer({ draw: drawInOrder });
  const host = await server.signedIn("host@example.com");
  const id = await host.createGame({ name: "Swap", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3, rosterMode: "host", ...(turnSeconds === undefined ? {} : { turnSeconds }) } });
  for (const name of ["Ann", "Bob", "Cat"]) await host.command(id, { type: "AddPlayer", playerId: name.toLowerCase(), name });
  await host.command(id, { type: "StartGame" });
  return { ...server, host, id, user: userEvent.setup() };
}

/** The countdown for this Player, once it shows this time. Screens redraw it every moment, so give them one. */
const timerShows = (name: string, text: RegExp) =>
  waitFor(() => expect(screen.getByRole("timer", { name: new RegExp(`${name}'s time`, "i") })).toHaveTextContent(text), { timeout: 2000 });
const timer = (name: string) => screen.getByRole("timer", { name: new RegExp(`${name}'s time`, "i") });

describe("The turn timer", () => {
  it("counts down from a minute for the Player who's up, on the Host's page", async () => {
    const { host, id } = await started();
    openApp(host, `/games/${id}`);
    await timerShows("Ann", /1:00/);

    clock.advance(15);

    await timerShows("Ann", /0:45/);
    expect(timer("Ann")).toHaveAttribute("data-state", "plenty");
  });

  it("warns at 30 seconds and again at 10, and only says time's up: nobody is skipped", async () => {
    const { host, id } = await started();
    openApp(host, `/games/${id}`);
    await timerShows("Ann", /1:00/);

    clock.advance(31);
    await timerShows("Ann", /0:29/);
    expect(timer("Ann")).toHaveAttribute("data-state", "warning");

    clock.advance(20);
    await timerShows("Ann", /0:09/);
    expect(timer("Ann")).toHaveAttribute("data-state", "urgent");

    clock.advance(30);
    await timerShows("Ann", /time's up/i);
    expect(screen.getByRole("region", { name: /ann's turn/i })).toBeInTheDocument();
  });

  it("starts afresh for each Player as they're called up", async () => {
    const { host, id } = await started();
    openApp(host, `/games/${id}`);
    await timerShows("Ann", /1:00/);
    clock.advance(40);
    await timerShows("Ann", /0:20/);

    await host.command(id, { type: "OpenGift", playerId: "ann", giftId: "g1", name: "Socks" });

    await timerShows("Bob", /1:00/);
  });

  it("can be reset by the Host", async () => {
    const { host, id, user } = await started();
    openApp(host, `/games/${id}`);
    await timerShows("Ann", /1:00/);
    clock.advance(50);
    await timerShows("Ann", /0:10/);

    await user.click(within(screen.getByRole("region", { name: /ann's turn/i })).getByRole("button", { name: /reset ann's timer/i }));

    await timerShows("Ann", /1:00/);
  });

  it("shows the same time on the big screen, even on a device whose clock is wrong", async () => {
    const { origin, id } = await started();
    clock.advance(20);

    openApp(browser(origin, { clockWrongBy: -300 }), `/games/${id}/screen`);

    await timerShows("Ann", /0:40/);
  });

  it("takes its length from the Game, set when it's created", async () => {
    const { signedIn } = await startServer({ draw: drawInOrder });
    const host = await signedIn("host@example.com");
    openApp(host);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /new game/i }));
    await user.click(screen.getByRole("button", { name: /customize settings/i }));
    await user.clear(screen.getByLabelText(/seconds per turn/i));
    await user.type(screen.getByLabelText(/seconds per turn/i), "90");
    await user.click(screen.getByRole("button", { name: /create the game/i }));
    for (const name of ["Ann", "Bob"]) {
      await user.type(await screen.findByLabelText(/player's name/i), name);
      await user.click(screen.getByRole("button", { name: /add player/i }));
      await screen.findByText(name);
    }

    await user.click(screen.getByRole("button", { name: /start game/i }));

    await timerShows("Ann", /1:30/);
  });

  it("isn't shown when the Host turns it off", async () => {
    const { host, id } = await started(0);
    openApp(host, `/games/${id}`);

    await screen.findByRole("region", { name: /ann's turn/i });
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });
});
