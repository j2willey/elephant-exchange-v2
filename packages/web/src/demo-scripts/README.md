# Guided demo scripts

The **guided tour** at `/guided/<script id>` plays a written-out White Elephant swap on a real demo Game, one speech bubble at a time over the Host console, with the scoreboard and a guest's phone following along. It needs no sign-in, like "Try a demo game", and the demo page links to it (▶ Guided tour).

| File | What it is |
|---|---|
| [`FORMAT.md`](FORMAT.md) | The script format: players, scripted Draws, gifts, photos, steps, actions, bubble targets, and how Back works |
| [`format.ts`](format.ts) | The same format as TypeScript types |
| [`scripts/`](scripts/) | The scripts, one `<id>.json` each. [`happy-path.json`](scripts/happy-path.json): 8 players, 50 steps, from the welcome to Highlights |
| [`photos/PLACEHOLDERS.md`](photos/PLACEHOLDERS.md) | The pictures the scripts post. A picture not added yet is drawn as a placeholder card with its description |
| [`play.ts`](play.ts) | No server: an action → its Command, the `expect` check, and `validate`, which plays a script through the rules alone |
| [`runner.ts`](runner.ts) | Plays a script on a real demo Game through the API; Back rebuilds a fresh Game |
| [`targets.ts`](targets.ts) | Finds what a bubble points at on the console |
| [`photos.ts`](photos.ts), [`scripts.ts`](scripts.ts) | Loading photos (or drawing placeholders) and the scripts |
| [`../Guided.tsx`](../Guided.tsx) | The page: frames, bubbles, controls |
| [`prompts/author-script.md`](prompts/author-script.md) | Prompt for Claude Code to write another script |
| [`prompts/build-replay.md`](prompts/build-replay.md) | The prompt this was built from (kept as the record) |

## Checking a script

```
npm test -w packages/web -- test/demo-scripts.test.ts
```

It plays every script in `scripts/` through the real rules and lists anything wrong, each problem naming its step: a move the rules refuse, a Draw the rules wouldn't make, an `expect` that doesn't hold, a name, Gift, Photo or Post that doesn't exist. `test/guided-runner.test.ts` plays the happy path on a real server.

## How it works

- **Scripted Draws** ([ADR 0006](../../../../docs/adr/0006-demo-scripted-draws.md)). The server draws at random, so with each command the tour sends the Draws its script still has to make, in an `x-demo-draws` header. The server honours it only in a demo Game. `validate` works out how many Draws come before every action, so the server keeps nothing between commands.
- **Back and jumps rebuild.** A fresh demo Game is played up to the step without pauses; the old one is ended and deleted. Undo covers only the last Pick, not Posts.
- **Bubbles** are drawn in the page at full size over the shrunk console frame, placed from the target's position in the frame. They follow the console as it changes, scrolls or resizes; a target that can't be found puts the bubble in the middle.
- **Off script.** In development, an `expect` that doesn't hold on the server shows a red "Off script" line under the controls; in production it's logged. A move the server refuses stops the tour at that step with the reason.

## Adding a picture

Save it in `photos/` under the file name `PLACEHOLDERS.md` gives it (about 1600 px on the long side, under 300 KB). Nothing else changes: the tour uses the real picture from then on.
