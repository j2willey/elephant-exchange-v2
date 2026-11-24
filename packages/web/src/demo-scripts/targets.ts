/**
 * What a guided demo's bubble points at: a script's Target (FORMAT.md, "Targets") found on the Host console's laptop
 * layout (LaptopConsole.tsx), in the console frame's document. Null for "center", or when it isn't on the page.
 */
import type { Target } from "./format.js";

export interface TargetNames {
  /** A Gift key's label as the console shows it now: its name, or "Finn's gift" while unnamed. */
  giftLabel(key: string): string | undefined;
  /** A Post ref's postId. */
  postId(ref: string): string | undefined;
}

/** Quoted for a CSS attribute selector. */
const quoted = (value: string) => `"${value.replace(/["\\]/g, "\\$&")}"`;

export function findTarget(doc: Document, target: Target, names: TargetNames): Element | null {
  const colon = target.indexOf(":");
  const kind = colon < 0 ? target : target.slice(0, colon);
  const arg = colon < 0 ? "" : target.slice(colon + 1);
  const q = (selector: string) => doc.querySelector(selector);
  const button = (label: string) => q(`button[aria-label=${quoted(label)}]`);
  /** The first button showing these words that's on screen (some appear twice: a menu and a footer). */
  const buttonSaying = (words: string, root: ParentNode = doc) =>
    [...root.querySelectorAll("button")].find((b) => b.textContent?.includes(words) && b.getClientRects().length > 0) ??
    [...root.querySelectorAll("button")].find((b) => b.textContent?.includes(words)) ??
    null;
  const playerRow = (name: string) => [...doc.querySelectorAll(".lc-players li")].find((li) => li.getAttribute("aria-label")?.startsWith(`${name} — `)) ?? null;
  const gift = (key: string) => names.giftLabel(key);

  switch (kind) {
    case "center":
      return null;
    case "start-game":
      return buttonSaying("Start game");
    case "player-row":
      return playerRow(arg);
    case "open":
      return button(`Open a gift for ${arg}`);
    case "steal":
      return button(`Steal for ${arg}`);
    case "skip":
      return button(`Skip ${arg}`);
    case "keep": {
      const row = playerRow(arg);
      return row ? ([...row.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Keep ")) ?? null) : null;
    }
    case "gift-row": {
      const label = gift(arg);
      return label === undefined ? null : q(`.lc-gifts li[aria-label=${quoted(label)}]`);
    }
    case "name-gift": {
      const label = gift(arg);
      return label === undefined ? null : button(`What is ${label}?`);
    }
    case "edit-gift": {
      const label = gift(arg);
      return label === undefined ? null : button(`Edit ${label}`);
    }
    case "final-round-panel":
      return q('section[aria-label="Final Round"]');
    case "chat":
      return q('[role="feed"][aria-label="Chat"]');
    case "post": {
      const id = names.postId(arg);
      return id === undefined ? null : doc.getElementById(`feed-post-${id}`);
    }
    case "undo":
      return buttonSaying("Undo last pick");
    case "end-game":
      return buttonSaying("End Game");
    case "screen-switch":
      return q('[role="group"][aria-label="Scoreboard shows"]');
    case "invite":
      return buttonSaying("Invite");
    default:
      return null;
  }
}
