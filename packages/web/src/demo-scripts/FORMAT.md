# Guided demo script format

A **demo script** is a short White Elephant game written out in advance: who's in it, who gets drawn when, which Gifts get opened and stolen, what people post to the 💬 Chat, and what a speech bubble says at each step. The **guided replay** plays a script on a real demo Game, one bubble at a time, with Next and Back. The types are in [`format.ts`](format.ts); the first script is [`scripts/happy-path.json`](scripts/happy-path.json).

The rule that matters: **every action is something the app already does.** Game moves are the rules module's Commands (`packages/rules/src/index.ts`), sent with `api.command` exactly as the Host console sends them. Posts and Reactions go as the made-up Players through `api.as(playerId)` (the demo stand-in of ADR 0004). Pitches and Scoreboard switches use the Host's own `api.setPitch` and `api.setScreen`. If the rules would refuse a step, the script is wrong, not the rules.

## The file

```jsonc
{
  "format": 1,
  "id": "happy-path",
  "title": "A swap from start to finish",
  "summary": "…",
  "game": { "name": "…", "tagline": "…", "options": { /* GameOptions */ }, "postsPerMinute": 0 },
  "players": ["Ann", "Ben", …],          // the Roster, added in this order
  "draws":   ["Ann", "Ben", "Cat", …],    // who every Draw picks, in order
  "gifts":   { "blanket": { "name": "Heated blanket", "description": "…" }, … },
  "photos":  { "blanket": { "file": "heated-blanket.jpg", "placeholder": "A cozy plaid heated blanket…" } },
  "steps":   [ … ]
}
```

- **players**: names, unique. Steps say `"Ann"`, never an id; the replay keeps a name → playerId map.
- **gifts**: short keys (`"blanket"`) → what the Host types. Steps say `"blanket"`; the replay makes the giftId (`crypto.randomUUID()`, as the console does) when the Gift is opened.
- **photos**: keys → a file under `packages/web/src/demo-scripts/photos/` plus a description. The pictures don't exist yet: until a file is there, the replay draws a plain placeholder card showing the description. `"asset:demo-gift-table"` means the app's existing `packages/web/src/assets/demo-gift-table.webp`.

### Draws

The Draw is random on the server (`randomDraw` in `packages/server/src/server.ts`), but a script needs the same order every time. So `draws` lists every Player the Draw will pick, in order. With `activeSlots: 1` the rules draw two at the start (one up, one On Deck), then one more each time a Turn ends. A **Skip** returns the Player to the pool and draws a replacement from everyone else, so a skipped Player appears in `draws` twice.

The rules already take the Draw as a function (`DrawFn`, "tests pass a script"), so scripted Draws are a server change only: for a demo Game, its Host may say which Players to draw next, in an `x-demo-draws` header ([ADR 0006](../../../../docs/adr/0006-demo-scripted-draws.md)). The replay works out which Draws are left before each command by playing the script through the rules (`play.ts`). Draws are still logged as `PlayerDrawn` events, so ADR 0001 holds.

## Steps

Each step is one bubble. A step can also run actions.

```jsonc
{
  "id": "s05-ann-opens",
  "chapter": "Opening and stealing",   // optional heading in the step list
  "run": "next",                       // "enter" (default) or "next"
  "actions": [ { "do": "open", "player": "Ann", "gift": "blanket" } ],
  "bubble": { "text": "Ann picks a wrapped gift. The Host presses 🎁…", "target": "open:Ann", "placement": "right" },
  "pauseMs": 600,                      // wait after actions before the bubble shows (default 600)
  "holdMs": 4000,                      // autoplay dwell (default from text length, at least 3 s)
  "expect": { "up": "Ben", "onDeck": "Cat", "holders": { "blanket": "Ann" } }
}
```

**`run`** says when the actions happen:

- `"enter"` (the default): the actions run as the step is reached, then the bubble shows and points at the result ("A heated blanket! It's on the Gift Tracker").
- `"next"`: the bubble shows first, pointing at the button the Host would press ("The Host presses 🎁"); the actions run when the viewer presses Next.

A typical move is two steps: a `"next"` step pointing at the button, then an `"enter"` step (often with no actions) pointing at what changed.

**Back** goes to the previous step exactly as it was first shown. The state shown at step *k* is: every action of steps 1 to *k*−1, plus step *k*'s own actions if it runs on `"enter"`. The simplest reliable way is to rebuild: make a fresh demo Game and replay those actions without bubbles. Undo can't do it alone (it covers only the last Pick, and not Posts).

**`expect`** is checked after the step's actions. It's how a script notices it has drifted from the rules. Only what's listed is checked.

## Actions

| `do` | Fields | Sends |
|---|---|---|
| `startGame` | | Command `StartGame` |
| `open` | `player`, `gift`, `unnamed?` | `OpenGift` with the gift's name and description; `unnamed: true` sends `name: ""`, like **⏩ Name it later** (the Gift shows as "Finn's gift") |
| `describe` | `gift` | `DescribeGift` with the gift's name and description from `gifts` (naming an unnamed Gift, or correcting one) |
| `steal` | `player`, `gift` | `Steal` |
| `skip` | `player` | `Skip` (a Player who isn't there; the next Draw replaces them) |
| `startFinalRound` | `finalists`, `leftoverGifts` | `StartFinalRound` |
| `keep` | `player` | `KeepGift` (Final Round) |
| `takeReturned` | `player`, `gift` | `TakeReturnedGift` (Final Round: a Returned Gift on the table) |
| `undo` | | `Undo` |
| `endGame` | | `EndGame` |
| `post` | `as`, `text?`, `photo?`, `gift?`, `replyTo?`, `ref?` | `api.as(player).post(…)`. `photo` is a photos key; `gift` attaches it to that Gift; `replyTo` is an earlier post's `ref`; `ref` names this post for later steps |
| `react` | `as`, `post`, `emoji` | `api.as(player).react(gameId, postId, emoji, true)`. Emoji: 👍 ❤️ 😂 🎉 🔥 😮 ⛄ or `leg-lamp` |
| `pitch` | `holder`, `gift`, `tagline?`, `text?`, `photo?` | `api.setPitch(gameId, giftId, {…}, holderId)`: the Host writing the holder's part, which the app allows |
| `screen` | `mode` | `api.setScreen`: `gifts`, `rules`, `qr`, `catalog`, `highlights` |

The server doesn't say which Post was just made, so after a `post` the replay finds it the way `chatter()` in `Demo.tsx` does: the newest of that Player's Posts with that text.

## Targets

What a bubble points at, on the Host console's laptop layout (`LaptopConsole.tsx`, used at 1000 px and wider). Player names and Gift keys are the script's own; the replay turns a Gift key into the Gift's label as it stands now (`gifts()` in the rules: its name, or "Finn's gift" while unnamed).

| Target | Element today |
|---|---|
| `center` | Nothing: the bubble sits in the middle |
| `start-game` | the **Start game** button |
| `player-row:Ann` | `.lc-players li[aria-label^="Ann — "]` |
| `open:Ann` | `button[aria-label="Open a gift for Ann"]` (🎁) |
| `steal:Ann` | `button[aria-label="Steal for Ann"]` (😈) |
| `skip:Ann` | `button[aria-label="Skip Ann"]` (⤵) |
| `keep:Ann` | the **Keep ‹gift›** button in Ann's row (Final Round) |
| `gift-row:blanket` | `.lc-gifts li[aria-label="‹label›"]` in the Gift Tracker |
| `name-gift:hotsauce` | `button[aria-label="What is ‹label›?"]` (✏️ What is it?) |
| `edit-gift:blanket` | `button[aria-label="Edit ‹label›"]` (✏️) |
| `final-round-panel` | `section[aria-label="Final Round"]` (**Ready for the Final Round?**) |
| `chat` | `[role="feed"][aria-label="Chat"]` |
| `post:ann-cat` | `#feed-post-‹postId›` |
| `undo` | the **↩ Undo last pick** button |
| `end-game` | the **🛑 End Game** button |
| `screen-switch` | `[role="group"][aria-label="Scoreboard shows"]` |
| `invite` | the **🔗 Invite** button |

If a target isn't on the page when its bubble shows (scrolled away, or a typo), the replay scrolls it into view; failing that it shows the bubble at the center and logs a warning in development.

**Steals point at the Gift row, not "Select gift".** On the console a Steal is two presses: 😈 on the Player, then **Select gift** on the Gift. The Select gift buttons only appear after a real 😈 press (it's the console's own state), and the replay sends the Steal through the API, so a script points at `steal:Cat` for the first bubble and at `gift-row:blanket` for the second.

## Writing captions

Captions are public wording, so CLAUDE.md's rule applies: the app adds to a party's swap, phones are optional, claims stay modest, and the Feed is **💬 Chat** on screen. Use the domain words from CONTEXT.md (Gift, Steal, Victim, On Deck, Frozen, No Take-Backs, Final Round, Returned Gift) the way the app does. One or two short sentences per bubble.
