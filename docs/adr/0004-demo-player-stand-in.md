# A demo Game's sample phone acts as a made-up Player, by header, for its Host only

The demo page (`/games/:id/demo`) shows a demo Game three ways at once: the Host console, the Live scoreboard and a phone, each the real page in a frame, so whoever is being shown the app can press every button. The phone has to be one of the demo's made-up Players, so its tabs show that Player's turn, Gift and Posts. But it runs in the Host's own browser and carries the Host's sign-in cookie, and the made-up Players have no accounts. So the phone's requests name their Player in an `x-demo-player` header, and the server lets that request act as the Player under a stand-in identity, `demo-player:<playerId>`.

The server honours the header only when all three hold: the Game is a demo (`games.demo`), the signed-in person is its Host or a Co-host, and the Player is on its Roster. Anything else gets 403, so a stray or forged header never lets anyone in or out. The stand-in has no role, so the phone can't run the Game; it posts and votes as the Player, apart from the Host's own vote. It isn't an email address, so nothing is ever sent to it, and it never becomes a `users` row.

We chose this over giving each made-up Player a real session (accounts nobody owns, sessions to clean up) and over a separate "pretend phone" component (a second copy of the guest view to keep in step with the real one). The cost is a small exception in how a request's identity is worked out: `signedInAs` checks the stand-in first.

## Consequences

- The exception is confined to `/api/games/:id/*` in demo Games, and only for that Game's Hosts. Sent to a real Game, the header is refused with 403.
- A custom header can't be sent cross-site without a CORS preflight, which the server doesn't grant, so another site can't use a Host's cookie to act as a Player.
- The frames need the app to be allowed to frame itself: ww-edge sends `X-Frame-Options: SAMEORIGIN` for Elephant Exchange, not `DENY`.
- Posts and votes by a made-up Player are stored under the stand-in, and go with the Game when it's deleted.
