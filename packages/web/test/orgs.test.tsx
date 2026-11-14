import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { openApp, startServer } from "./harness.js";

const tinyPng = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

async function signedInHome() {
  const server = await startServer();
  const me = await server.signedIn("scout@example.com");
  openApp(me);
  return { ...server, me, user: userEvent.setup() };
}

async function createOrg(user: ReturnType<typeof userEvent.setup>, name: string) {
  const section = await screen.findByRole("region", { name: /your organizations/i });
  await user.type(within(section).getByLabelText(/new organization/i), name);
  await user.click(within(section).getByRole("button", { name: /create/i }));
  return screen.findByRole("heading", { name });
}

describe("Organizations", () => {
  it("can be created by anyone signed in, who is taken to set its Theme", async () => {
    const { me, user } = await signedInHome();

    await createOrg(user, "Lodge 22");

    expect(screen.getByLabelText(/main color/i)).toBeInTheDocument();
    expect(await me.myOrgs()).toMatchObject([{ name: "Lodge 22" }]);
  });

  it("are listed on the Organizer's home screen", async () => {
    const server = await startServer();
    const me = await server.signedIn("scout@example.com");
    await me.createOrg("Lodge 22");
    openApp(me);

    const section = await screen.findByRole("region", { name: /your organizations/i });
    expect(await within(section).findByRole("link", { name: "Lodge 22" })).toBeInTheDocument();
  });

  it("lets the Organizer set its colors, and hand one back to the app's own", async () => {
    const { me, user } = await signedInHome();
    await createOrg(user, "Lodge 22");

    fireEvent.input(screen.getByLabelText(/main color/i), { target: { value: "#c8102e" } });
    fireEvent.input(screen.getByLabelText(/page color/i), { target: { value: "#fff8f0" } });
    await user.click(screen.getByRole("button", { name: /save colors/i }));
    await waitFor(async () => expect((await me.myOrgs())[0]).toMatchObject({ color: "#c8102e", page: "#fff8f0" }));

    await user.click(screen.getByRole("button", { name: /use the app's page color/i }));
    await waitFor(async () => expect((await me.myOrgs())[0]).toMatchObject({ color: "#c8102e", page: null }));
  });

  it("lets the Organizer add a logo and a background, and take them off", async () => {
    const { me, user } = await signedInHome();
    await createOrg(user, "Lodge 22");

    await user.upload(screen.getByLabelText(/^logo/i), new File([tinyPng], "logo.png", { type: "image/png" }));
    expect(await screen.findByRole("img", { name: /lodge 22 logo/i })).toBeInTheDocument();
    await user.upload(screen.getByLabelText(/background image/i), new File([tinyPng], "bg.png", { type: "image/png" }));
    expect(await screen.findByRole("img", { name: /background/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /remove the logo/i }));
    await waitFor(() => expect(screen.queryByRole("img", { name: /lodge 22 logo/i })).not.toBeInTheDocument());
    expect((await me.myOrgs())[0]).toMatchObject({ logoUrl: null, backgroundUrl: expect.stringMatching(/background/) });
  });

  it("can't be changed by anyone else, who's told so", async () => {
    const server = await startServer();
    const id = await (await server.signedIn("scout@example.com")).createOrg("Lodge 22");

    openApp(await server.signedIn("other@example.com"), `/orgs/${id}`);

    expect(await screen.findByText(/only its organizer/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/main color/i)).not.toBeInTheDocument();
  });
});
