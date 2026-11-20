# Elephant Exchange

A live companion for White Elephant (Yankee Swap) gift exchanges.

A swap with 50 Players can drag on for two or three hours, mostly because people don't know what's on the table when their name is called. Elephant Exchange puts the Game on everyone's phone and on a big screen. Everyone can see which Gifts are open, who holds them and how often they've been stolen, so people decide quickly when called. The Host runs the Game from their own phone.

This is v2, a full rewrite of [v1](https://github.com/j2willey/Elephant-Exchange) as a hosted service that many Organizations can use. Its first real event is a holiday party in December 2026.

## What works today

- **Landing page and Host's Guide:** a signed-out visitor sees what the app is for and v1's three reasons, signs in to host, or opens a Game from the link or code their Host sent. The Guide (`/guide`; the old `/playbook` still works) is v1's hosting guide, brought up to date.
- **Sign-in by emailed link:** there are no passwords. Links are sent through [Resend](https://resend.com), last 15 minutes and work once. The server stores only a hash of each token, and requests for links are rate-limited by address, by IP and per day.
- **Setting up a Game:** the Host names the Game, picks how many Players take a Turn at once and how many Steals freeze a Gift, then adds Players, one at a time or by pasting the guest list (one name per line, straight from an email or a spreadsheet; anyone already added is skipped). Co-hosts can help run it.
- **The play screen:** the Host or a Co-host opens a Gift, makes a Steal or Skips an absent Player for each active Player, and can Undo. A Gift gets optional details when it's opened, and the Host can correct its name or details at any time, even after the Game ends. The app enforces No Take-Backs and Frozen Gifts. Players are called at random, and the next one is shown On Deck so they can get ready.
- **The Final Round and Ending the Game:** the first Players called get one last chance to steal, and Returned Gifts and Leftover Gifts are handled. The Host can end the Game at any moment.
- **The live watch screen (the scoreboard):** made for a projector and laid out as v1's. It has a banner with the Game's name, who's up with their timer, and who's On Deck. Below is the Gift board: each Gift with a thumbnail of its latest Photo, its holder, and a Steals chip ("1/3 steals", red with one Steal left, then Frozen). Gifts still in play come first, most stolen at the top, with Frozen ones dimmed at the bottom. When there are more Gifts than fit, the board scrolls slowly through them and starts over (a page at a time for anyone who has asked for less motion). Down the right side are the newest six Posts and a QR code for joining, which never scrolls out of sight. From the Host console (laptop or phone), the Host or a Co-host switches what it shows, as in v1: the **Gifts** board, the **Rules** (with the Game's own Steal limit), the join **QR code** filling the screen, or a **Catalog** of every Gift as a card with its Photo, holder and Steals. It shows only what everyone may see, even when opened in the Host's browser. Every screen updates within moments.
- **My Games:** each person's home screen lists the Games they run.
- **Joining from the QR code:** anyone can follow a Game without signing in. In a Self sign-up Game, people can add themselves as Players from their phones, even after the Game has started. The sign-in link brings them straight back to the Game. The phone remembers the name they post or join as, and fills it in next time.
- **Stars:** anyone following on a phone can Star the Gifts they'd like to steal; Starred Gifts move to the top of their list. Stars stay on that phone and are never sent anywhere.
- **The turn timer:** a countdown for each Player who's up, set per Game (60 seconds by default), on the Host's page and the big screen. It turns amber at 30 seconds and red at 10. It's a guide only: nobody is skipped automatically, and the Host can reset it. Screens count against the server's clock, so a phone set to the wrong time still agrees with the room.
- **Posts and the Feed:** signed-in Players and Guests post a few words to the Game's Feed, optionally about a Gift, which then shows them under it. The Host or a Co-host can switch Moderation at any moment: **Open**, **Approval** (each Post waits to be approved) or **Paused**, and can hide any single Post. Pending and Hidden Posts never leave the server except to their poster and the Hosts.
- **Photos:** a Post can carry a Photo, or be just one. The phone shrinks it before sending, and the server re-encodes it (with [sharp](https://sharp.pixelplumbing.com)), which removes EXIF data such as where it was taken. Photos are deleted 60 days after the Game's last move; before then the Host can download them all as a .zip album, with captions.
- **The Worst Gift Vote:** once the Game ends, the Host opens a vote. Everyone signed in gets one vote, which they can move until it closes. While it's open the Host switches the big screen between **Live** counts, **Hidden** ones, and a **Parade** of every Gift as a reminder; under Hidden and Parade the counts never leave the server. Closing reveals the winner, whose holder picks a prize; the Host breaks any tie. The big screen then shows the results as v1 did: the worst Gift with its latest Photo, the top five in shrinking type with their holders and votes, and "Thanks for playing! See you next year!" (shown too when a Game ends with no vote).
- **The Host console, scoreboard and Settings:** the Host runs the Game from the Host console, which links to the read-only scoreboard (for the TV), the link for guests and Settings. Settings holds the Game options (name, Players taking a turn at once, Steals before a Gift is Frozen, the turn timer, who adds Players, changeable at any time), Feed posting, the Photos album, the Game's look, and ending the Game.
- **A guest's phone:** who's up and On Deck in a bar pinned to the top, and tabs at the bottom for the Gifts, You (joining, your turn, the Gift you hold), the Feed and posting.
- **Demo Games:** "Try a demo game" makes a Game with 2 to 40 made-up Players, ready to start. On a wide screen it opens the demo view: the Host console and the Live scoreboard as tabs, beside the phone of one of the made-up Players, each the real page so every button works. The phone acts as that Player only in a demo Game and only for its Host ([ADR 0004](docs/adr/0004-demo-player-stand-in.md)); the Host console of a demo Game links back to its demo view.
- **The admin page:** for the addresses in `ADMIN_EMAILS` only: everyone who has signed in (and whether it's OK to ask them for feedback, which they tick at sign-in or on the home screen), every Game, and deleting a Game or the smoke test's leftovers.
- **Organizations and Themes:** anyone signed in can create an Organization and give it a Theme: a main color, a page color, a logo and a background image. A Host picks one of their Organizations for a Game (and can switch it at any time), and can override any part of the Theme for that Game alone. Every screen follows changes live, and text colors adjust by WCAG contrast so they stay readable whatever the colors.

The words used throughout (Turn, Pick, Victim, Frozen and so on) are defined in [CONTEXT.md](CONTEXT.md).

## How it's built

| Package | What it is |
| --- | --- |
| [`packages/rules`](packages/rules) | The gift-exchange rules as pure TypeScript functions (`decide` and `evolve`). It does no I/O, so it's easy to test thoroughly. |
| [`packages/server`](packages/server) | Hono on Node, with SQLite through Drizzle (migrations are generated by drizzle-kit). It handles HTTP commands and sign-in, and uses Socket.IO for live updates. |
| [`packages/web`](packages/web) | React 19 with React Router and Vite. It's designed for phones first and has no UI framework. |

Key decisions, each recorded as an ADR in [`docs/adr`](docs/adr):

1. **[A Game is a log of Picks](docs/adr/0001-game-as-log-of-picks.md).** The server appends events and rebuilds the Game by replaying them through the rules. Undo, replaying after a restart and summaries after the Game all follow from this. Random Draws are logged, so a replay always comes out the same.
2. **[TypeScript end to end](docs/adr/0002-typescript-end-to-end.md).** One language and shared types across the rules, server and browser. Changes go over HTTP, and Socket.IO only pushes updates out to screens.
3. **[SQLite on one droplet](docs/adr/0003-sqlite-on-one-droplet.md).** One process and one database file; Photos and Theme images are plain files beside it. Backups are copies of those.
4. **[A demo Game's sample phone acts as a made-up Player](docs/adr/0004-demo-player-stand-in.md).** It runs in the Host's browser and names its Player in a header, which the server honours only in a demo Game, only for its Hosts.
5. **[Usage statistics outlive deletes](docs/adr/0005-usage-stats-outlive-deletes.md).** Counts and times live in their own tables, taken from each Game's log and once more before a delete, and people appear only as a keyed hash of their email. The admin's Stats page (`/admin/stats`) shows them; `?ref=` on a shared link records where people came from.

Every screen keeps the newest copy of the Game it has seen, judged by a version number that rises with each change. So a slow reply can never overwrite a newer live update.

## How it's tested

It's built test-first. The rules have unit tests. The server is tested over HTTP and real sockets. The web app is tested with Testing Library against the real server, which runs in memory on a free port; each test drives the screens the way a person would, with cookies and live updates. No module in the app is mocked: tests only stand in for things outside it, such as the email service, the random Draw and the clock.

```sh
npm install
npm test                          # every package
npm run typecheck
```

GitHub Actions runs the typecheck and every test on each push, then builds the Docker image, starts it and runs the smoke test against it (`.github/workflows/ci.yml`).

## Running it locally

Requires Node 26.

```sh
npm install
npm run dev --workspace @elephant/server   # API and live updates on :3001
npm run dev --workspace @elephant/web      # app on http://localhost:5173
```

When developing, sign-in links are printed to the server log instead of being emailed. Settings are environment variables:

| Variable | What it sets | Default |
| --- | --- | --- |
| `PORT` | The server's port | `3001` (`3000` in Docker) |
| `BASE_URL` | Where people open the app; sign-in links point here | `http://localhost:5173` |
| `DB_PATH` | The SQLite database file | `elephant.db` |
| `PHOTOS_DIR` | Where Post Photos are stored | `photos` |
| `THEMES_DIR` | Where Theme logos and backgrounds are stored | `themes` |
| `WEB_ROOT` | The built web app to serve (production only; in development Vite serves it) | unset |
| `TRUST_PROXY` | `1` behind a reverse proxy (on the droplet, ww-edge's Caddy), so its `X-Forwarded-For` is believed | unset |
| `ADMIN_EMAILS` | Who may use the admin page, `/admin` (comma-separated): who has signed in, every Game, deleting a Game or the smoke test's `@example.com` leftovers. To anyone else it isn't there | unset: nobody |
| `RESEND_API_KEY`, `MAIL_FROM` | Email sign-in links through Resend, from an address on a verified domain | unset: links go to the log |
| `SIGNIN_LINKS_PER_DAY` | Sign-in links emailed per day, site-wide; match it to the Resend plan | 100 (Resend's free plan) |

In Docker, the data settings point into the `/data` volume.

## Running it in Docker

This is how it runs in production: one image holds the server and the built app, and the database lives on a volume.

```sh
docker compose up -d --build      # http://localhost:3000
docker compose logs -f app        # sign-in links appear here until email is set up
```

The container shuts down cleanly on `docker stop`, leaving the database complete in its one file. Docker checks `/api/health` every 30 seconds and marks the container unhealthy if the app or its database stops answering.

### On the droplet, behind ww-edge

The droplet runs several apps behind one front door, [ww-edge](https://github.com/j2willey/ww-edge) (private): a Caddy on ports 80 and 443 that routes each request by hostname to a container on the shared Docker network `edge`. Cloudflare sits in front of it (proxied, SSL mode Full) and holds the public certificate.

`compose.prod.yaml` joins the app to `edge` as the container `elephant-exchange`, publishes no port, and trusts ww-edge's `X-Forwarded-For`. The HTTPS headers and the upload size limit live in ww-edge's `caddy/sites/elephant-exchange.caddy`. Settings live in `.env` (see `.env.example`): which compose files to use, the domain, and the Resend key and sender address for emailing sign-in links.

### Backups

`scripts/backup.sh` copies the database while the app runs (SQLite's online backup, so nothing is caught half-written), keeps the newest 14 in the data volume, and copies each out to `./backups` on the host, along with the Photos and Theme images. On the droplet, run it nightly from cron (the script's header has the line), and pull `./backups` to another machine now and then with `rsync`, since a backup on the same droplet won't survive losing it.

From Omarchy, `./scripts/pull-backups.sh` copies them to `~/elephant-backups` (databases accumulate there; Photos mirror the droplet). `scripts/deploy.sh` runs it after every deploy.

To restore one (the database, Photos and Theme images), on the droplet:

```sh
./scripts/restore.sh backups/elephant-2026-12-13T0315Z.db
```

It backs up what's there first, stops the app, removes SQLite's `-wal` and `-shm` files (so the old database's last writes aren't replayed onto the restored one), copies the backup in and starts the app again. Moving to a new server is in `docs/scale-plan.md` ("Moving to a new server").

### Deploying to the droplet

Once:

1. In Cloudflare (DNS for `elephantexchange.app`): an A record for `@` and a CNAME `www` → `elephantexchange.app`, both proxied; SSL/TLS mode **Full**.
2. In Resend, verify the domain (its DNS records go in Cloudflare, not proxied) and create an API key.
3. In ww-edge: `caddy/sites/elephant-exchange.caddy` is already there; on the droplet, `cd ~/ww/ww-edge && git pull` and reload Caddy (`rcaddy`).
4. On the droplet: `git clone https://github.com/j2willey/elephant-exchange-v2 ~/ww/elephant-exchange-v2`, then `cp .env.example .env`, fill it in, and `chmod 600 .env`.
5. `mkdir -p backups`, then add the cron line from the top of `scripts/backup.sh`, and copy `./backups` off the droplet now and then.
6. From Omarchy, deploy (below), then run the smoke test against it: `SMOKE_ALLOW_EMAIL=1 SMOKE_URL=https://elephantexchange.app SMOKE_LOGS="ssh conductor 'cd ww/elephant-exchange-v2 && docker compose logs app --no-log-prefix'" npm run smoke`. It reads sign-in links from the log, so it only works before the Resend key is set. With Resend on, it would email made-up `@example.com` addresses (using the day's allowance, and bouncing), which is why it refuses to run against anywhere but this machine unless `SMOKE_ALLOW_EMAIL=1` is set.

To deploy, from Omarchy with `main` pushed: `./scripts/deploy.sh`. It builds the image here, tagged with the commit (the droplet's one CPU is shared, so nothing is built there), ships it over ssh, backs up, pulls, sets `TAG` in the droplet's `.env`, and restarts on the new image. Then reload any open tabs (Ctrl+Shift+R): a page already open keeps running the code it loaded.

### Rolling back

The droplet keeps the last three images. On the droplet: `docker images elephant-exchange` to see their tags, set `TAG=` in `.env` to the one before, and `docker compose up -d`. If the newer version ran a migration, restore the backup the deploy took first (above).

## Smoke test

The smoke test uses Playwright to drive real browsers against the running, packaged app. Its three tests:

- **A whole party:** a Host signs in and sets up a Game; a guest follows from the Game's link, signs in, joins, posts words and a sideways camera Photo (checked upright and stripped of its location); the Host downloads the album; the big screen shows the Posts; then the Game ends and the guest's vote is counted live on the big screen, through the Parade to the reveal. Live updates throughout.
- **Reloads and caching:** any of the app's addresses loads, and the build's files are cached for good.
- **Themes:** an Organizer colors their Organization and gives it a logo, runs a Game in it, and the big screen is drawn in that Theme.

```sh
docker compose up -d --build
npm run smoke                      # or SMOKE_URL=https://… SMOKE_LOGS="ssh … docker compose logs app --no-log-prefix" npm run smoke
```
