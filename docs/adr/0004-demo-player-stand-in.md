# A demo Game's sample phone acts as a made-up Player, by header, for its Host only

The demo page (`/games/:id/demo`) shows a demo Game three ways at once: the Host console, the Live scoreboard and a phone, each the real page in a frame, so whoever is being shown the app can press every button. The phone has to be one of the demo's made-up Players, so its tabs show that Player's turn, Gift and Posts. But it runs in the Host's own browser and carries the Host's sign-in cookie, and the made-up Players have no accounts. So the phone's requests name their Player in an `x-demo-player` header, and the server lets that request act as the Player under a stand-in identity: the Player's stand-in email, given when the made-up Player is added (`fay@example.com`, `fay2@example.com` for a second Fay), or `demo-player:<playerId>` for a Player who has none.

The server honours the header only when all three hold: the Game is a demo (`games.demo`), the signed-in person is its Host or a Co-host, and the Player is on its Roster. Anything else gets 403, so a stray or forged header never lets anyone in or out. The stand-in has whatever role its address has in the Game: normally none, so the phone can't run the Game, but if the Host made that Player a Co-host (as with real people, to try the Co-hosts panel), the phone acts as a Co-host. It is never the Host. It posts and votes as the Player, apart from the Host's own vote. The stand-in emails are at example.com, which takes no mail, so nothing is ever sent to one and nobody can sign in as one; they never become `users` rows.

We chose this over giving each made-up Player a real session (accounts nobody owns, sessions to clean up) and over a separate "pretend phone" component (a second copy of the guest view to keep in step with the real one). The cost is a small exception in how a request's identity is worked out: `signedInAs` checks the stand-in first.

## Consequences

- The exception is confined to `/api/games/:id/*` in demo Games, and only for that Game's Hosts. Sent to a real Game, the header is refused with 403.
- A custom header can't be sent cross-site without a CORS preflight, which the server doesn't grant, so another site can't use a Host's cookie to act as a Player.
- The frames need the app to be allowed to frame itself: ww-edge sends `X-Frame-Options: SAMEORIGIN` for Elephant Exchange, not `DENY`.
- Posts and votes by a made-up Player are stored under the stand-in, and go with the Game when it's deleted.

_Updated 2026-11-22: stand-ins became example.com addresses so the Host can make one a Co-host; the stand-in now has that address's role (never the Host's). Visitors trying the demo without signing in count as not signed in in real Games._
