import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { browser, openApp, startServer } from "./harness.js";

const admin = "boss@willey.test";

async function withPeople() {
  const server = await startServer({ adminEmails: [admin] });
  const ann = await server.signedIn("ann@willey.test");
  const party = await ann.createGame({ name: "Ann's party", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
  await ann.createGame({ name: "Demo game", demo: true, options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3, rosterMode: "self", turnSeconds: 60 } });
  const tester = await server.signedIn("guest-abc@example.com");
  await tester.createGame({ name: "Smoke test game", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
  return { ...server, party, me: await server.signedIn(admin), user: userEvent.setup() };
}

const peopleRows = () => within(screen.getByRole("table", { name: /people/i })).getAllByRole("row").slice(1);
const gameRows = () => within(screen.getByRole("table", { name: /games/i })).getAllByRole("row").slice(1);

describe("The admin page", () => {
  it("is linked from the home screen for an admin, and lists the people, test accounts hidden until asked for", async () => {
    const { me, user } = await withPeople();
    openApp(me);

    await user.click(await screen.findByRole("link", { name: /admin/i }));

    await screen.findByRole("table", { name: /people/i });
    const emails = () => peopleRows().map((r) => within(r).getAllByRole("cell")[0]!.textContent);
    expect(emails()).toContain("ann@willey.test");
    expect(emails()).not.toContain("guest-abc@example.com");
    const ann = peopleRows().find((r) => r.textContent!.includes("ann@willey.test"))!;
    expect(within(ann).getByRole("cell", { name: /^1 \+ 1 demo$/ })).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /show test accounts/i }));
    expect(emails()).toContain("guest-abc@example.com");
  });

  it("isn't there for anyone else", async () => {
    const { signedIn } = await withPeople();
    const ann = await signedIn("ann@willey.test");
    openApp(ann);
    await screen.findByRole("button", { name: /new game/i });
    expect(screen.queryByRole("link", { name: /admin/i })).not.toBeInTheDocument();

    openApp(ann, "/admin");
    expect(await screen.findByText(/nothing here/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("lists the Games, marks the demos, and deletes one after asking", async () => {
    const { me, user } = await withPeople();
    openApp(me, "/admin");

    await screen.findByRole("table", { name: /games/i });
    const row = (name: string) => gameRows().find((r) => r.textContent!.includes(name));
    expect(row("Demo game")).toHaveTextContent(/demo/i);
    expect(row("Ann's party")).toHaveTextContent(/ann@willey.test/);

    await user.click(within(row("Ann's party")!).getByRole("button", { name: /delete/i }));
    await user.click(await screen.findByRole("button", { name: /yes, delete ann's party/i }));

    await waitFor(() => expect(row("Ann's party")).toBeUndefined());
    expect(row("Demo game")).toBeDefined();
  });

  it("deletes the smoke test's leftovers after asking", async () => {
    const { me, user } = await withPeople();
    openApp(me, "/admin");
    await screen.findByRole("table", { name: /games/i });
    expect(gameRows().some((r) => r.textContent!.includes("Smoke test game"))).toBe(false); // hidden until asked for
    await user.click(screen.getByRole("checkbox", { name: /show test accounts/i }));
    expect(gameRows().some((r) => r.textContent!.includes("Smoke test game"))).toBe(true);

    await user.click(screen.getByRole("button", { name: /delete test data/i }));
    await user.click(await screen.findByRole("button", { name: /yes, delete test data/i }));

    expect(await screen.findByText(/deleted 1 person, 1 game and 0 organizations/i)).toBeInTheDocument();
    await waitFor(() => expect(gameRows().some((r) => r.textContent!.includes("Smoke test game"))).toBe(false));
  });
});

describe("Saying a feedback email is OK", () => {
  it("can be ticked when asking for a sign-in link", async () => {
    const { origin, linkFor } = await startServer();
    const phone = browser(origin);
    openApp(phone, "/login");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/email address/i), "ann@willey.test");
    await user.click(screen.getByRole("checkbox", { name: /ok to contact me/i }));
    await user.click(screen.getByRole("button", { name: /send.*link/i }));
    await screen.findByText(/check your email/i);
    await phone.redeemLink(new URLSearchParams(linkFor("ann@willey.test").split("?")[1]).get("token")!);

    expect((await phone.session())!.feedbackOk).toBe(true);
  });

  it("is off unless ticked, and can be changed on the home screen", async () => {
    const { signedIn } = await startServer();
    const ann = await signedIn("ann@willey.test");
    openApp(ann);
    const user = userEvent.setup();

    const box = await screen.findByRole("checkbox", { name: /ok to contact me/i });
    expect(box).not.toBeChecked();
    await user.click(box);

    await waitFor(async () => expect((await ann.session())!.feedbackOk).toBe(true));
  });
});

describe("A demo Game", () => {
  it("is marked as one", async () => {
    const { signedIn } = await startServer({ adminEmails: [admin] });
    const ann = await signedIn("ann@willey.test");
    openApp(ann);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /try a demo/i }));
    await user.click(screen.getByRole("button", { name: /create demo game/i }));
    await screen.findByRole("button", { name: /start game/i });

    const games = await (await signedIn(admin)).adminGames();
    expect(games).toEqual([expect.objectContaining({ name: "Demo game", demo: true })]);
  });
});
