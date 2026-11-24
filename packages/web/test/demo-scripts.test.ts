import { describe, expect, it } from "vitest";
import { SCRIPTS } from "../src/demo-scripts/scripts.js";
import { validate } from "../src/demo-scripts/play.js";
import type { DemoScript } from "../src/demo-scripts/format.js";

/** Every guided demo script plays through the real rules, as written, with every step's `expect` holding. */
describe("Guided demo scripts", () => {
  it("include the happy path", () => {
    expect(Object.keys(SCRIPTS)).toContain("happy-path");
  });

  for (const [file, script] of Object.entries(SCRIPTS)) {
    it(`${file} plays through the rules`, () => {
      expect(script.id).toBe(file);
      expect(validate(script).problems).toEqual([]);
    });
  }

  it("catch a script that drifts from the rules", () => {
    const script = SCRIPTS["happy-path"]!;
    const swapped: DemoScript = { ...script, draws: ["Ben", "Ann", ...script.draws.slice(2)] };
    expect(validate(swapped).problems[0]).toMatch(/up: Ben, not Ann/);
    const refused: DemoScript = { ...script, steps: [{ id: "x", actions: [{ do: "steal", player: "Ann", gift: "blanket" }], bubble: { text: "", target: "center" } }] };
    expect(validate(refused).problems).toEqual([expect.stringMatching(/^x \(steal\): the rules refuse it/)]);
  });
});
