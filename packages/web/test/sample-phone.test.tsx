import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SAMPLE_GAME_ID } from "../src/SamplePhone.js";
import { browser, openApp, startServer } from "./harness.js";

describe("The sample phone behind the front page's picture", () => {
  for (const path of [`/games/${SAMPLE_GAME_ID}`, "/sample"]) {
    it(`shows what a guest's phone shows, from the pictured party, at ${path}`, async () => {
      const { origin } = await startServer(); // a server that has never heard of that Game
      const user = userEvent.setup();
      openApp(browser(origin), path);

      const note = await screen.findByRole("region", { name: /a sample/i });
      expect(within(note).getByRole("link", { name: /try the demo/i })).toHaveAttribute("href", "/try");
      expect(screen.queryByText(/there's no game at this link/i)).not.toBeInTheDocument();
      expect(await screen.findByText(/acme holiday party/i)).toBeInTheDocument();

      await user.click(screen.getByRole("tab", { name: /gifts/i }));
      expect(await screen.findByText(/espresso machine/i)).toBeInTheDocument();
      await user.click(screen.getByRole("tab", { name: /chat/i }));
      expect(await screen.findByText(/one steal from frozen/i)).toBeInTheDocument();
    });
  }
});
