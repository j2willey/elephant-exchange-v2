# Prompt: write another demo script

Paste everything below the line into Claude Code (on Omarchy, from the repo root), and replace the last paragraph with what the new script should show.

---

Write a new **guided demo script** for Elephant Exchange: a short White Elephant game, written out step by step, that the guided replay plays on a real demo Game with speech bubbles over the Host console.

## Read first

1. `packages/web/src/demo-scripts/FORMAT.md` and `packages/web/src/demo-scripts/format.ts`: the format, the actions, and the bubble targets.
2. `packages/web/src/demo-scripts/scripts/happy-path.json`: a complete, working example. Copy its shape and rhythm.
3. `CONTEXT.md` for the domain words and the rules as players know them, and `CLAUDE.md` for the public wording rule, which every caption must follow (the app adds to a party's swap, phones are optional, modest claims, the Feed is called 💬 Chat on screen).
4. `packages/rules/src/index.ts`, the rules themselves: `decide` says what's allowed, `withDraws` when Draws happen and how many, `moveUp` who's up next. When CONTEXT.md and the code disagree, the code wins.

## How to write it

- **Players**: plain, distinct first names (the happy path uses Ann to Hana; use others so scripts don't blur together). Between 4 and 12 unless the scenario needs more.
- **Draws**: list every Draw in order. With `activeSlots: 1`, the start draws two (one up, one On Deck) and every Turn that ends with an opened Gift draws one more, until nobody's left. A Skip draws a replacement from everyone else, and the skipped Player must appear again later in `draws`. Work it out from `withDraws` rather than guessing.
- **Gifts**: fun, ordinary, safe for a work party. No brand names, no real people, nothing that could embarrass a guest.
- **Steps**: one bubble each, one or two short sentences. A move is usually two steps: a `"run": "next"` step pointing at the button the Host presses (🎁 `open:`, 😈 `steal:`, ⤵ `skip:`, `keep:`), then an `"enter"` step pointing at the result (`gift-row:`, `player-row:`, `post:`). A Steal is two bubbles: `steal:<player>` then `gift-row:<gift>`. Put Posts and Reactions in the result steps so the Chat moves along with the game.
- **Photos**: describe each one in `photos` with `"placeholder": "PLACEHOLDER: …"`, a one-sentence brief of the picture (what's in it, phone-camera snapshot style). The replay draws a placeholder card from that text until a real picture is added. Don't make or download any image. List the new photos at the bottom of `packages/web/src/demo-scripts/photos/PLACEHOLDERS.md`.
- **Expect**: add `expect` to every result step: who's up and On Deck, and who holds the Gifts that just moved. These are how we find out a script has drifted from the rules. `expect` is checked after that step's actions, so on a `"run": "next"` step it describes the state after the button press.
- Say only what the app really does. If a caption describes a feature, check the code that it works that way.

## Check it

Run it through the real rules before you finish:

```
npm test -w packages/web -- test/demo-scripts.test.ts
```

The test plays every script in `scripts/` through the rules (`play.ts`) and lists anything wrong, each problem naming its step. It must pass. Fix the script until it does; never change the rules to fit a script. Then open `/guided/<id>` in the dev app (`npm run dev` in `packages/server` and `packages/web`) and step through it: the bubbles must land on what they describe.

Then save it as `packages/web/src/demo-scripts/scripts/<id>.json` and tell me in a few lines what it shows and how many steps it has.

## This script

<Describe the scenario here. For example: "A 12-player office party with 2 players up at once (activeSlots 2), a Late Arrival added mid-game, a Gift opened with Name it later, an Undo of a mistaken steal, a Gift Frozen after 2 steals (maxSteals 2), and a Final Round where someone opens a Leftover Gift. About 40 steps.">
