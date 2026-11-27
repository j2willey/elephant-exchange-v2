import { describe, expect, it } from "vitest";
import { placeBubble } from "../src/Guided.js";

const stage = { width: 1000, height: 800 };
const size = { w: 300, h: 60 };
const overlaps = (a: { left: number; top: number }, b: { left: number; top: number; width: number; height: number }) =>
  a.left < b.left + b.width && b.left < a.left + size.w && a.top < b.top + b.height && b.top < a.top + size.h;

describe("A guided tour's bubble", () => {
  // A Gift row in the middle column; the player who's up in the column to its left, a little lower.
  const giftRow = { left: 450, top: 300, width: 500, height: 100 };
  const upRow = { left: 20, top: 360, width: 400, height: 60 };

  it("goes on the side asked for when nothing's in the way", () => {
    expect(placeBubble(giftRow, size, stage, "left")).toMatchObject({ side: "left", left: 450 - 14 - 300 });
  });

  it("slides along its side to keep off the row of the player who's up, the arrow still reaching its target", () => {
    const spot = placeBubble(giftRow, size, stage, "left", [upRow]);
    expect(spot.side).toBe("left");
    expect(overlaps(spot, upRow)).toBe(false);
    expect(spot.top + spot.arrow).toBeGreaterThanOrEqual(giftRow.top);
    expect(spot.top + spot.arrow).toBeLessThanOrEqual(giftRow.top + giftRow.height);
  });

  it("moves to another side when sliding can't clear it", () => {
    const tall = { left: 20, top: 200, width: 400, height: 300 };
    const spot = placeBubble(giftRow, size, stage, "left", [tall]);
    expect(spot.side).toBe("below");
    expect(overlaps(spot, tall)).toBe(false);
  });

  it("goes where it would have anyway when nowhere is clear", () => {
    const everything = { left: 0, top: 0, width: 1000, height: 800 };
    expect(placeBubble(giftRow, size, stage, "left", [everything]).side).toBe("left");
  });
});
