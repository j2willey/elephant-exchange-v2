# Guided demo scripts

Work in progress for a **guided tour** of Elephant Exchange: a scripted game played on a real demo Game, with speech bubbles over the Host console's buttons and Next / Back controls. Nothing here is wired into the app yet; these files are the design and the first script, ready for the build.

| File | What it is |
|---|---|
| [`FORMAT.md`](FORMAT.md) | The script format: players, scripted Draws, gifts, photos, steps, actions, bubble targets, and how Back works |
| [`format.ts`](format.ts) | The same format as TypeScript types |
| [`scripts/happy-path.json`](scripts/happy-path.json) | The first script: 8 players, 50 steps. Opening, a steal, No Take-Backs, a skipped player who comes back, a chain of steals ending in a steal-back that freezes a Gift, Name it later, a Pitch, photos and replies in the 💬 Chat, a Final Round with a keep, a steal and a Returned Gift, End Game, Highlights |
| [`photos/PLACEHOLDERS.md`](photos/PLACEHOLDERS.md) | The script's photos. All but one are placeholders for now, each with a description |
| [`check-script.ts`](check-script.ts) | Plays a script through the real rules module and checks each step's `expect` |
| [`prompts/build-replay.md`](prompts/build-replay.md) | Prompt for Claude Code to build the replay, on its own branch |
| [`prompts/author-script.md`](prompts/author-script.md) | Prompt for Claude Code to write more scripts |

Check a script against the rules:

```
node --experimental-strip-types demo-script/check-script.ts demo-script/scripts/happy-path.json
```

The happy path passes all 50 steps.

## Two things the build has to add

- **Scripted Draws.** The server draws at random, so a script can't otherwise know who's up. The build prompt asks for a demo-only way for the Host to name the next Draws, guarded like the `x-demo-player` header (ADR 0004). The rules module doesn't change.
- **Back by rebuilding.** Undo covers only the last Pick, not Posts, so Back makes a fresh demo Game and fast-forwards to the step before.
