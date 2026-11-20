import { RECOMMENDED_OPTIONS } from "@elephant/rules";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { openApp, startServer } from "./harness.js";

describe("Deleting your own Games and Organizations from the home screen", () => {
  it("deletes a Game the Host runs, after asking; a Game they co-host has no Delete", async () => {
    const { signedIn } = await startServer();
    const ann = await signedIn("ann@example.com");
    const bob = await signedIn("bob@example.com");
    const party = await ann.createGame({ name: "Ann's party", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    await ann.createGame({ name: "Ann's other party", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    const bobs = await bob.createGame({ name: "Bob's party", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    await bob.addCohost(bobs, "ann@example.com");
    const user = userEvent.setup();
    openApp(ann);

    const list = await screen.findByRole("list", { name: /your games/i });
    const row = (name: string) => within(list).queryByRole("listitem", { name });
    await waitFor(() => expect(row("Bob's party")).toBeInTheDocument());
    expect(within(row("Bob's party")!).queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();

    // Asked first, and Keep it keeps it.
    await user.click(within(row("Ann's party")!).getByRole("button", { name: /delete ann's party/i }));
    await user.click(screen.getByRole("button", { name: /keep it/i }));
    expect(row("Ann's party")).toBeInTheDocument();

    await user.click(within(row("Ann's party")!).getByRole("button", { name: /delete ann's party/i }));
    expect(screen.getByText(/can't be undone/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /yes, delete ann's party/i }));

    await waitFor(() => expect(row("Ann's party")).not.toBeInTheDocument());
    expect(row("Ann's other party")).toBeInTheDocument();
    expect(await ann.game(party)).toBeUndefined();
  });

  it("asks to end a Game in progress first, then deletes it", async () => {
    const { signedIn } = await startServer();
    const ann = await signedIn("ann@example.com");
    const id = await ann.createGame({ name: "Ann's party", options: { ...RECOMMENDED_OPTIONS, activeSlots: 1, maxSteals: 3 } });
    for (const [playerId, name] of [["bob", "Bob"], ["cat", "Cat"]] as const) await ann.command(id, { type: "AddPlayer", playerId, name });
    await ann.command(id, { type: "StartGame" });
    const user = userEvent.setup();
    openApp(ann);

    const list = await screen.findByRole("list", { name: /your games/i });
    const row = () => within(list).queryByRole("listitem", { name: "Ann's party" });
    await waitFor(() => expect(row()).toHaveTextContent(/in progress/i));

    await user.click(within(row()!).getByRole("button", { name: /delete ann's party/i }));
    expect(within(row()!).getByText(/still in progress/i)).toBeInTheDocument();
    expect(within(row()!).queryByRole("button", { name: /yes, delete/i })).not.toBeInTheDocument();

    // Keep playing changes nothing.
    await user.click(within(row()!).getByRole("button", { name: /keep playing/i }));
    expect(row()).toHaveTextContent(/in progress/i);

    await user.click(within(row()!).getByRole("button", { name: /delete ann's party/i }));
    await user.click(within(row()!).getByRole("button", { name: /end the game/i }));
    await waitFor(() => expect(row()).toHaveTextContent(/finished/i));
    await user.click(within(row()!).getByRole("button", { name: /yes, delete ann's party/i }));

    await waitFor(() => expect(row()).not.toBeInTheDocument());
    expect(await ann.game(id)).toBeUndefined();
  });

  it("deletes an Organization, after asking", async () => {
    const { signedIn } = await startServer();
    const ann = await signedIn("ann@example.com");
    await ann.createOrg("Lodge 22");
    await ann.createOrg("Troop 7");
    const user = userEvent.setup();
    openApp(ann);

    const orgs = await screen.findByRole("region", { name: /your organizations/i });
    const row = (name: string) => within(orgs).queryByRole("listitem", { name });
    await waitFor(() => expect(row("Lodge 22")).toBeInTheDocument());

    await user.click(within(row("Lodge 22")!).getByRole("button", { name: /delete lodge 22/i }));
    expect(within(orgs).getByText(/games that used its look keep going/i)).toBeInTheDocument();
    await user.click(within(orgs).getByRole("button", { name: /yes, delete lodge 22/i }));

    await waitFor(() => expect(row("Lodge 22")).not.toBeInTheDocument());
    expect(row("Troop 7")).toBeInTheDocument();
    expect((await ann.myOrgs()).map((o) => o.name)).toEqual(["Troop 7"]);
  });
});
