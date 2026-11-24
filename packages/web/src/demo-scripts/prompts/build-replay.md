# Prompt: build the guided demo replay

Paste everything below the line into Claude Code on Omarchy, from the repo root (`elephant-exchange-v2`), or ask a Claude Code session there to follow this file.

---

Build a **guided demo replay** for Elephant Exchange: a page that plays a scripted White Elephant game on a real demo Game, with speech bubbles over the Host console's buttons and Next / Back controls, so someone can be walked through the app one move at a time.

## Work on its own branch

Work on the existing `guided-demo` branch (`git switch guided-demo`; it already holds `demo-script/` and is on GitHub). If it has uncommitted work, use a worktree instead. This is experimental: commit on that branch only, don't merge into `main`, don't deploy, and don't push unless I ask.

## Read first

1. `CLAUDE.md` (the public wording rule applies to every caption), `CONTEXT.md` (domain words), `README.md` (how to run and test).
2. `docs/adr/0001-game-as-log-of-picks.md` and `docs/adr/0004-demo-player-stand-in.md`.
3. `demo-script/FORMAT.md` and `demo-script/format.ts`: the script format. `demo-script/scripts/happy-path.json` is the first script.
4. Code: `packages/rules/src/index.ts` (Commands, `decide`/`evolve`, `DrawFn`), `packages/server/src/game-store.ts` (`command()` and the `draw` it uses), `packages/server/src/server.ts` (`randomDraw`, the commands route), `packages/server/src/access.ts` (how demo Games are told apart and the `x-demo-player` header), `packages/web/src/Demo.tsx` (`DemoGame`, `chatter()`, `DemoPage`, `ScaledFrame`), `packages/web/src/LaptopConsole.tsx` (the Host console the bubbles point at), `packages/web/src/api.ts` (`command`, `as`, `post`, `react`, `setPitch`, `setScreen`, `setGameOptions`, `createGame`, `deleteGame`).

The script format was written from that code; if something in it doesn't match the code, trust the code and tell me what you changed.

## What to build

### 1. Scripted Draws, for demo Games only (server)

A script names who every Draw picks (`draws`). Today the server always draws at random. Add a way for a demo Game's Host to choose the next Draws, without touching the rules module: `DrawFn` is already injected, and tests already pass a scripted one.

Suggested shape (choose a better one if you find it): the commands route accepts an optional `draws: string[]` (playerIds) beside the command, honoured only when the Game is a demo and the caller is its Host or a Co-host, and refused with 403 otherwise, mirroring ADR 0004's rule. `game-store`'s `command()` takes an optional per-call `DrawFn` that picks the first listed id that is among the candidates, falling back to random. The replay sends, with each command, the script's remaining draws. The Draw is still logged as a `PlayerDrawn` event, so replay and Undo work as before. Write a short ADR (`docs/adr/0006-…`) for it, and server tests: honoured in a demo Game for its Host; refused (403) in a real Game and for anyone else; an id not in the pool falls back to random.

### 2. The script runner (web, no UI)

A module that loads a script and drives a demo Game through the real API:

- **Create**: `api.startVisitor()` if needed, `api.createGame({ name, options, demo: true })`, `api.setGameOptions` for the tagline, `postsPerMinute` and `repitchMinutes`, then `AddPlayer` for each name in order (keep a name → playerId map). Unlike `DemoGame`, don't shuffle the names.
- **Actions**: map each `do` to the call in FORMAT.md's table. Gift keys get a `crypto.randomUUID()` when opened. Posts go through `api.as(playerId)`; find the new Post's id the way `chatter()` does, and keep a ref → postId map. Photos: load `demo-script/photos/<file>`, or `asset:demo-gift-table` from `packages/web/src/assets/demo-gift-table.webp`; if the file doesn't exist, draw a placeholder on a canvas (a soft colored card, a 📷, and the `placeholder` text wrapped) and post that as a JPEG. The pictures are deliberately placeholders for now; real ones will be dropped into `demo-script/photos/` later.
- **State at a step**: the state shown at step *k* is every action of steps 1..*k*−1, plus step *k*'s own if it runs on `"enter"` (FORMAT.md, "Steps"). **Back** rebuilds: create a fresh demo Game, replay the actions up to that point with no bubbles and no pauses, then show the step. Delete the old demo Game (`api.deleteGame`) once the new one is ready. Use Undo only as an optimisation if you like, never as the only way back.
- **Expect**: after a step's actions, check its `expect` against the Game the server returns. In development, a failed check shows a red banner in the control bar naming the step and what differed; in production, log it and carry on.
- A rules error from the server (409) stops the replay at that step with the message shown: the script is broken.

Also add a **validator** that plays a script through `@elephant/rules` alone (`decide`/`evolve` with a scripted `DrawFn`), checking every `expect`, and a test that runs it on every file in `demo-script/scripts/`. `demo-script/check-script.ts` is a throwaway version of this you can start from; it already passes on `happy-path.json`.

Move the scripts and photos wherever fits the build best (for example `packages/web/src/demo-scripts/`), and say where.

### 3. The guided page (web)

A new route, `/guided/:scriptId` (or as you see fit), reachable from the existing demo page with a "▶ Guided tour" link. It needs no sign-in, like "Try a demo game".

- It shows the **Host console** of the script's Game, the laptop layout, in a frame drawn at laptop width and scaled to fit, the way `DemoPage` does with `ScaledFrame`. If there's room, keep the scoreboard tab and the sample phone from `DemoPage` beside it; they follow the Game live, which shows off that everything updates everywhere.
- **Bubbles** sit over the console frame, pointing at the step's target. The frame is same-origin, so find the element in `iframe.contentDocument` with FORMAT.md's target table, scroll it into view inside the frame, and place the bubble from its `getBoundingClientRect()` times the frame's scale plus the frame's own position. Re-place on resize, on scroll inside the frame and after each live update (a `MutationObserver` on the frame's body, throttled). A target that can't be found falls back to `center`. Gently highlight the target (an outline ring drawn in the overlay, not by changing the app's own styles). The bubble has an arrow toward the target and honours `placement` when it fits.
- **Controls** in a bar under (or over) the frames: ◀ Back, Next ▶, ⏯ Autoplay (uses `pauseMs` and `holdMs`), ↺ Restart, the step number "12 / 50", the chapter name, and a step list to jump to any step (a jump is a rebuild, like Back). Keyboard: → / Space for Next, ← for Back. While actions run, Next is disabled and shows a small spinner.
- The viewer can still click the real console between steps, but say in a one-line hint that doing so may take the game off script; Restart puts it back.
- Bubbles and controls must follow the Game's look (`theme.tsx` colors) and work in light and dark, and the bubble text must be readable at the scaled size: draw the bubbles in the outer page at full size, not inside the scaled frame.

### 4. Tests

- The server tests for scripted Draws (above).
- The validator test over every script.
- One Playwright test (in `e2e/`) that opens `/guided/happy-path`, presses Next through the first eight steps, checks that a bubble is visible each time and that the console shows "Heated blanket" held by Cat after the first steal, then presses Back once and checks the blanket is with Ann again.

Run `npm test`, `npm run typecheck` and the new e2e test before you finish. Then summarise for me: what you built, where the files went, anything in the script format you changed and why, and what's left. Commit on the `guided-demo` branch with clear messages; don't push unless I ask.
