# A demo Game's Host may say who the next Draws pick, by header, for a guided tour

The guided tour (`/guided/:scriptId`) plays a written-out Game on a real demo Game, one speech bubble at a time: "Ann picks a wrapped gift", "Cat steals the heated blanket". A script can only say that if it knows who is up, and the Draw is random. So with each command the tour sends the Draws its script still has to make, in order, as comma-separated playerIds in an `x-demo-draws` header. For that one command the server draws the first listed Player who may be drawn at that moment, and uses them up. Anyone listed who can't be drawn (already drawn, or the Skipped Player the replacement mustn't be) is passed over; once none of the list can be drawn, the usual random Draw takes over.

The server honours the header only in a demo Game (`games.demo`). The commands route already lets only the Game's Host and Co-hosts through, so a demo's Draws can be chosen only by whoever runs it. Sent to a real Game, the header is refused with 403, even by its Host: a real party's Draw stays random.

Nothing changes in the rules module. `decide` already takes the Draw as a function (`DrawFn`, which tests already script); the store takes a different one for a single command. Every Draw is still logged as a `PlayerDrawn` event, so a Game rebuilt from its log, and Undo, work exactly as before (ADR 0001).

We chose this over a Draw order stored with the Game (a new column, and state to clear when the tour goes Back) and over a `draws` field in the command body (every command's schema would carry a field that only demos use). The tour works out which Draws are left before each command by playing its script through the rules on its own, so the server keeps nothing between commands.

## Consequences

- The tour can make any demo Game play out exactly as written, and the script checker (`demo-scripts/validate.ts`) can prove offline that the rules allow it.
- A custom header can't be sent cross-site without a CORS preflight, which the server doesn't grant, so another site can't choose a demo's Draws with a Host's cookie (as for `x-demo-player`, ADR 0004).
- A Host of a demo Game could pick its Draws by hand with the header. That's harmless: a demo has no real Players.
