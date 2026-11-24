/**
 * Guided demo script format (version 1).
 *
 * A script is a short, scripted White Elephant game that the guided replay plays on a real demo Game, one bubble at
 * a time. Every action maps to something the app already does: a game Command (packages/rules/src/index.ts) sent
 * through `api.command`, or a Post, Reaction, Pitch or Scoreboard switch through the same `api` calls the app uses.
 * Nothing here bypasses the rules: a step the rules would refuse is a broken script.
 *
 * Scripts are JSON files that match `DemoScript`. See FORMAT.md for the full description and examples.
 */

export interface DemoScript {
  /** Format version. Always 1 for now. */
  format: 1;
  /** Short id, used in the URL (e.g. "happy-path"). Lowercase letters, digits and hyphens. */
  id: string;
  /** Shown in the replay's control bar. */
  title: string;
  /** One or two sentences for whoever picks a script: what it shows. */
  summary: string;

  game: {
    /** The Game's name, as the Host would type it. */
    name: string;
    /** Optional Game Tagline (the line under the name). */
    tagline?: string;
    /** The same GameOptions a Host picks when creating a Game. turnSeconds 0 keeps the countdown out of the demo. */
    options: {
      activeSlots: number;
      maxSteals: number;
      turnSeconds: number;
      rosterMode: "host" | "self";
      approveNames: boolean;
      moderation: "open" | "approval" | "paused";
    };
    /** Feed Limits. 0 = no limit, so a fast rebuild (Back) never trips "3 Posts a minute". Default 0. */
    postsPerMinute?: number;
    /** Minutes between "Pitch it again". Default 0. */
    repitchMinutes?: number;
  };

  /** The Roster, in the order the Players are added. Names must be unique; steps refer to Players by these names. */
  players: string[];

  /**
   * Who the Draw picks, in order, for the whole Game. Every Draw the rules make takes the next name here.
   * A Skipped Player goes back in the pool, so they appear here twice: once when first drawn, once when drawn again.
   * The replay checks that each name is one the rules would allow at that moment; if not, the script is broken.
   */
  draws: string[];

  /** The Gifts, by a short key that steps use. `name` is what the Host types when it's opened. */
  gifts: Record<string, { name: string; description?: string }>;

  /**
   * Photos the script posts, by key. `file` is relative to demo-script/photos/ (or "asset:demo-gift-table" for the
   * app's existing packages/web/src/assets/demo-gift-table.webp). `placeholder` describes the picture: until a real
   * file exists, the replay draws a plain placeholder card with this text, and it doubles as the brief for the
   * picture that will replace it.
   */
  photos?: Record<string, { file: string; placeholder: string }>;

  steps: Step[];
}

export interface Step {
  /** Unique within the script, e.g. "s12-cat-steals". Shown in the control bar and used in error messages. */
  id: string;
  /** Optional section heading for the control bar's step list ("Getting started", "The Final Round"). */
  chapter?: string;

  /**
   * When this step's actions run:
   *  - "enter" (default): as the step is reached, before the bubble shows. The bubble then points at the result.
   *  - "next": the bubble shows first, pointing at the button the Host would press; the actions run when the
   *    viewer presses Next. Use this for "the Host presses 🎁".
   */
  run?: "enter" | "next";

  /** Zero or more actions, run in order. Omit for a narration-only step. */
  actions?: Action[];

  /** The speech bubble. */
  bubble: Bubble;

  /** How long to wait after the actions before showing the bubble, so the live update lands. Default 600 ms. */
  pauseMs?: number;
  /** In autoplay, how long the bubble stays before moving on. Default: about 60 ms per character, at least 3 s. */
  holdMs?: number;

  /**
   * Optional checks on the Game state once this step's actions have run. The validator (and the replay, in
   * development) fails loudly if they don't hold, which catches a script that drifts from the rules.
   */
  expect?: Expect;
}

export interface Bubble {
  /** What the bubble says. Plain text; keep it to one or two short sentences. Follow CLAUDE.md's public wording rule. */
  text: string;
  /** What the bubble points at. See Target in FORMAT.md. "center" for none. */
  target: Target;
  /** Preferred side of the target. Default "auto". */
  placement?: "auto" | "above" | "below" | "left" | "right";
}

/**
 * A UI element of the Host console (the laptop layout, LaptopConsole.tsx). Player names and Gift keys refer to the
 * script's own `players` and `gifts`; the replay turns them into the labels the page uses right now (a Gift opened
 * without a name is labelled "Finn's gift" until it's named).
 */
export type Target =
  | "center"
  | "start-game"
  | "final-round-panel"
  | "chat"
  | "undo"
  | "end-game"
  | "screen-switch"
  | "invite"
  | `player-row:${string}` // player name
  | `open:${string}` // player name: their 🎁 button
  | `steal:${string}` // player name: their 😈 button
  | `skip:${string}` // player name: their ⤵ button
  | `keep:${string}` // player name: their "Keep <gift>" button (Final Round)
  | `gift-row:${string}` // gift key: the Gift Tracker row
  | `name-gift:${string}` // gift key: its "✏️ What is it?" button
  | `edit-gift:${string}` // gift key: its ✏️ button
  | `post:${string}`; // post ref: that Post in the 💬 Chat

export type Action =
  // Game Commands (api.command). Player names and Gift keys are turned into the ids the replay made.
  | { do: "startGame" }
  | { do: "open"; player: string; gift: string; unnamed?: boolean } // OpenGift; unnamed = "⏩ Name it later" (name "")
  | { do: "describe"; gift: string } // DescribeGift with the gift's name and description from `gifts`
  | { do: "steal"; player: string; gift: string } // Steal
  | { do: "skip"; player: string } // Skip
  | { do: "startFinalRound"; finalists: number; leftoverGifts: number } // StartFinalRound
  | { do: "keep"; player: string } // KeepGift
  | { do: "takeReturned"; player: string; gift: string } // TakeReturnedGift
  | { do: "undo" } // Undo
  | { do: "endGame" } // EndGame
  // Sharing, as a made-up Player (api.as(playerId), the demo stand-in of ADR 0004).
  | { do: "post"; as: string; text?: string; photo?: string; gift?: string; replyTo?: string; ref?: string }
  | { do: "react"; as: string; post: string; emoji: "👍" | "❤️" | "😂" | "🎉" | "🔥" | "😮" | "⛄" | "leg-lamp" }
  // Host actions.
  | { do: "pitch"; holder: string; gift: string; tagline?: string; text?: string; photo?: string } // api.setPitch(..., holderId)
  | { do: "screen"; mode: "gifts" | "rules" | "qr" | "catalog" | "highlights" }; // api.setScreen

export interface Expect {
  /** Who's up now (game.active), in order. A single name is shorthand for [name]. */
  up?: string | string[];
  /** Who's On Deck (game.onDeck). [] or "" for nobody. */
  onDeck?: string | string[];
  /** Gift key -> holder name, or null for a Returned Gift on the table. Only the listed Gifts are checked. */
  holders?: Record<string, string | null>;
  /** Gift keys that must be Frozen. */
  frozen?: string[];
  /** Gift key -> steal count. */
  steals?: Record<string, number>;
  phase?: "setup" | "playing" | "finalRound" | "ended";
  /** Unopened Leftover Gifts in the Final Round. */
  leftoverGifts?: number;
}
