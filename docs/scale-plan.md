# Scale plan: what if it takes off?

Written 2026-11-18, ahead of the public launch (about 2026-11-24). It's a contingency, not work to do now: for each limit, what we'd see, what we'd change, how long it takes, and what users would notice.

## The load to plan for

Elephant Exchange's load is lumpy. Nearly all of it comes on December evenings, and most on Fridays and Saturdays (12/4–5, 12/11–12, 12/18–19). A party of 60–80 keeps ~60–80 phones and a scoreboard connected for about two hours, and makes a few moves a minute.

| Scenario | Parties at the busiest hour | Phones connected | Sign-in emails that day |
|---|---|---|---|
| Today (friends, the OA party) | 1–2 | ≤ 150 | ≤ 100 |
| 100 Organizations, one party each in December | 10–20 | 1,000–1,500 | 400–1,000 |
| 1,000 Organizations | 100–200 | 10,000+ | 5,000+ |

How each part copes:

- **CPU, database and live updates.** One Node process, SQLite and Socket.IO handle the 100-Organization case on today's droplet. A move is a few small writes, and each update goes only to that Game's room.
- **Email** runs out first, well before 100 Organizations.
- **One shared droplet** is the next risk. If it goes down, every party in progress goes down with it.

## Peak-season plan (decided 2026-11-20)

The window is short: a launch post around 11/23–25, the best chance to reach hosts 11/30–12/11, and the peak in the week of 12/14–18, before people take Christmas week off. After Christmas it's quiet. So any scale-up only has to last about six weeks. The plan deliberately assumes 100 phones a party (more like 40–50 in practice).

**What a code review found.** The hardware wasn't the first limit; the code was:

- **The Feed.** Every Post or Reaction sent every phone at that party back for the whole Feed, rebuilt from the database for each one. That's about 17 Feed requests a second at one lively 100-phone party, and about 350 a second with 20 parties at once, enough to fill the one core a Node process uses.
- **Photos.** They were sent full size (up to 1,600 px) to every phone in the Feed, and Cloudflare couldn't cache them: about 1 GB for a 30-Photo party.
- **One process, one core.** More cores barely help until the app runs on several servers (limit 5, 2–3 weeks), which is too late for this season.

**Fixed 2026-11-20, all tested:**

- **Feed signals are gathered** (`FEED_SIGNAL_MS`, 2,000 by default in production). The first change goes out at once; any more within the next two seconds go out together at the end, so a burst of Reactions means one round of fetches, not one per tap. The poster's own screen still updates at once.
- **The Feed is read once per change, not once per phone.** Each Game's Posts and Reactions are kept in memory until the Feed changes, and each request picks out what its viewer may see.
- **Photos have a small copy.** It's at most 640 px and about a quarter of the bytes. The Feed, a Gift's thumbnail, the scoreboard's lists and the highlights page show it; the full Photo loads only in the Photo viewer, the vote's reveal and the Highlights slideshow. A Photo from before the change gets its copy the first time it's asked for.
- **Cloudflare caches visible Photos.** Their addresses now end in `.jpg`, and a visible Photo is sent as `public, max-age=600`, so the phones at a party mostly get it from Cloudflare. Held and Hidden ones stay `private`. One hidden after it was fetched can still be loaded by its address from the cache for up to 10 minutes. The old address (`…/photo`) still works for pages loaded before.
- **Games nobody's using are let go from memory.** That's after 6 hours with no request and no screen watching, checked in the hourly sweep; the database always has them.
- **The overload guard** (`MAX_SCREENS`, 6,000 by default; `MAX_LAG_MS`, 300). When that many screens are connected, or the event loop's 99th-percentile delay passes 300 ms over a 5-second window, creating a Game or a demo is turned away with "Elephant Exchange is very busy right now… try again in a few minutes". Parties already under way carry on. Busy clears once the delay drops below half the limit. `/api/health` reports `busy` but stays healthy, so the uptime monitor doesn't page. **Tune both numbers after the load test.**

**Still to do:**

1. **Load test:** a throwaway droplet for a few hours (under $2), simulating 20, 100 and 200 parties of 100 phones posting, reacting and loading Photos ("Load test" below). Set `MAX_SCREENS` and `MAX_LAG_MS` from what it shows.
2. **Its own droplet for the season:** DigitalOcean CPU-Optimized, 2 dedicated vCPUs and 4 GB, from about $42 a month. Basic 2 vCPU / 4 GB at about $24 if the load test allows. Droplets are billed by the second (since 2026-01-01), so six weeks costs about six weeks. Move on a weekday morning before 11/30 (see "Moving to a new server" below).
3. **Peak week, only if the load test says so:** resize to 4 dedicated vCPUs (about $84 a month, about $20 for the week). More cores help only with Photo resizing and Caddy; the app itself uses one.
4. **January:** resize down, or move back to the shared droplet, and delete the seasonal one.

### Load test

`scripts/load-test.mjs` simulates parties against a running server. Each party is a demo Game with 50 made-up Players and `PHONES` (100) screens watching. The screens keep live connections, fetch the Feed whenever they're told it changed, and load each new Photo's small copy once. Meanwhile the party posts (a quarter with a Photo), reacts and opens Gifts. One signed-in Host runs every party, since a demo Game's Host may act as its made-up Players. Parties are added in stages (`STAGES`, default 20, 100, 200), each measured for `STAGE_MINUTES` (default 5). After each stage it prints how long each kind of request took (p50, p95, p99, max), how late phones heard of changes, the counts, and the errors. The script's header lists every setting.

A local run (Docker on Omarchy, 3–4 parties of 20–30 phones) answered the Feed in about 3 ms. Half of all Feed changes reached phones within 5 ms and the rest within the 2-second gathering window. Moves reached phones in 2–3 ms. A Photo post took about 270 ms, which is sharp resizing it, the heaviest single request.

**Running it (about two hours, under $2):**

1. **Two throwaway droplets in the same region:**
   - **Server:** the size you're considering, e.g. CPU-Optimized 2 vCPU / 4 GB.
   - **Load generator:** Basic 4 vCPU / 8 GB is plenty for about 20,000 phones.
2. **On the server droplet:**
   - Install Docker and `git clone` this repo.
   - Run `docker compose up -d --build`. That's plain HTTP on port 3000, with no Resend key, so sign-in links go to the log.
   - Give the container the same `mem_limit` as production, so memory is measured fairly.
3. **On the generator droplet:**
   - Install Node and clone the repo, then run `npm install`.
   - Run `ulimit -n 65536`.
   - Copy a real phone photo over (`PHOTO=`).
4. **Run it:**
   ```sh
   TARGET=http://<server-ip>:3000 PHOTO=~/real-photo.jpg \
     LOGS="ssh root@<server-ip> 'cd elephant-exchange-v2 && docker compose logs app --no-log-prefix'" \
     node scripts/load-test.mjs
   ```
5. **Meanwhile, on the server droplet:** `docker stats` (CPU and memory), and `uptime` (load average).
6. **Read the results:**
   - **Healthy:** the Feed under ~100 ms at p95, moves reaching phones within ~500 ms, no timeouts or disconnects.
   - **The limit:** the stage where p95 climbs past a second, or errors appear, is where this size tops out. Set `MAX_SCREENS` a safe step below the screens connected at that stage.
   - **Busy:** if the guard said busy (`health said busy`), check `MAX_LAG_MS` sits where users would start to notice.
7. **Delete both droplets.**

It refuses to run against elephantexchange.app. It talks to the server directly rather than through Cloudflare, so every Photo is served by the server. That's the worst case.

**Rough season total:** about $110–130, covering the droplet, a possible peak resize, Resend for one or two months, backups and load-test droplets. Jim's vault has the reasoning (`10-Projects/Elephant-Exchange/Peak-Scale-Plan.md`).

| Scenario | Parties at the peak hour | Phones connected | Expected after the fixes, on its own 2-dedicated-vCPU droplet |
|---|---|---|---|
| 100 companies | 15–25 | 1,500–2,500 | Comfortable |
| 1,000 companies | 150–250 | 15,000–25,000 | At or past the limit: the overload guard keeps parties already under way smooth |

## The limits, in the order we'd hit them

### 1. Sign-in emails (hit first, maybe at launch)

- **Today:**
  - Every guest who votes, posts or signs themselves up gets a sign-in link by email. A session then lasts 30 days.
  - The app caps links at 100 a day across the whole site (`DEFAULT_LIMITS.perDay` in `auth.ts`), to stay inside Resend's free plan (100 a day, 3,000 a month).
  - A Resend 429 has already shown up in CI logs.
- **What we'd see:** a guest is told "too many sign-in links" or that the email couldn't be sent. Every party on the site is hit at once.
- **The change:**
  - Upgrade Resend to the paid plan (at the time of writing, about $20 a month for 50,000 emails a month, with no daily cap; check current pricing).
  - Raise `SIGNIN_LINKS_PER_DAY` in the droplet's `.env` to match, then `docker compose up -d`.
  - Keep the per-address and per-IP limits as they are.
- **How long:** 15 minutes, plus a deploy.
- **What users notice:** nothing, if it's done before the launch post.
- **Recommendation: do this before the launch post.** It's the one item here that a modest success would hit.

### 2. The shared droplet (memory, and one machine for everything)

- **Today:**
  - The droplet has one CPU and 2 GB of memory, shared with Conductor and ww-edge.
  - EE's container is capped at 384 MB (`mem_limit` in `compose.prod.yaml`).
  - The busiest work is resizing photos with sharp: up to 12 MB in, 1600 px out. Several big photos at once is the likeliest way to hit 384 MB.
- **What we'd see:** the container restarts (OOM). Phones reconnect by themselves, and Games are rebuilt from the database, so nothing is lost. But the party sees a stall of a few seconds.
- **Changes, cheapest first:**
  1. **Raise `mem_limit`** to 512–768 MB, if the droplet has room (`free -h`). Five minutes and a deploy. Users notice nothing.
  2. **Resize the droplet** (DigitalOcean resize, CPU and memory only, so it can be undone). About 15 minutes, including a short reboot of the whole droplet.
  3. **Give EE its own droplet,** so a Conductor problem can't take down a party, and the other way round:
     - build a new droplet: Docker, ww-edge (or a plain Caddy) and this repo,
     - restore the latest backup to it,
     - point the DNS A record at it.

     About 2–3 hours. Users notice an outage of a minute or so while DNS switches.
- **When:** a resize or a move is never done on a party night. Do it on a weekday morning.
- **The one-core ceiling (noted 2026-11-21):** the app is one Node process, and its own code (Games, the Feed, live updates) runs on one CPU core. Only sharp's photo resizing (and Caddy, and the OS) use the others. So past 2 vCPUs a bigger droplet buys little; a faster core (CPU-Optimized, Premium) helps more. The load test measures where one process tops out, and that number says whether a viral month fits on one box. Beyond it, see "One server per Game" in limit 5.
- **During a resize or restart:** ww-edge shows a "Back in a minute" page (HTTP 503) instead of a bare error, and the app's calls get a JSON 503 they retry (`caddy/sites/elephant-exchange.caddy` in ww-edge, 2026-11-21). A resize reboots the whole droplet, Caddy included, so for that minute Cloudflare shows its own "can't reach the server" page.

### 3. One machine means one point of failure

- **Today:**
  - A nightly backup on the droplet (once its cron line is in), plus a backup before every deploy.
  - `scripts/deploy.sh` now copies `backups/` to Omarchy (`~/elephant-backups`) after every deploy; `scripts/pull-backups.sh` does the same by hand.
  - `scripts/restore.sh` restores a backup (database, Photos and Theme images), taking a backup of what's there first. Rehearsed locally 2026-11-18.
- **What we'd see:** if the droplet dies, the site is down until it's rebuilt (see "Moving to a new server" below). We'd lose everything since the last off-droplet copy.
- **The change (do now, it's cheap):**
  - Weekly `./scripts/pull-backups.sh` through December, and after any busy party night.
  - Turn on DigitalOcean's droplet backups (a fifth or so of the droplet's price; check current pricing). It's a whole-droplet copy kept off the machine with no work from us, so a lost droplet is a restore, not a rebuild.
  - Add a free uptime monitor (UptimeRobot or similar, checking `https://elephantexchange.app/api/health` every 5 minutes) that emails or texts on an outage.
- **Later:** Litestream, streaming SQLite to object storage. Conductor plans the same (#36). That cuts the worst-case loss from a day to seconds.

### 4. Games kept in memory (fixed 2026-11-20)

- **Before:** the server rebuilds each Game from its log once and keeps it in memory (`cache` in `server.ts`). It forgets a Game only when the Game is deleted. Each Game is small (kilobytes), so even thousands would fit. But memory grows with every Game opened since the last restart.
- **What we'd see:** memory slowly creeping up over a busy December, then a restart.
- **The change (done):** the hourly sweep forgets Games (and their Feeds) that nobody has asked for in 6 hours and no screen is watching. A Game that's opened again is simply rebuilt from the database. Users notice nothing.

### 5. More than one server (only at the 1,000-Organization scale)

Several servers is the expensive step, and the app is far from needing it. It would take:

- **Postgres in place of SQLite.** ADR-0003 names this as the path. Drizzle supports both, but the queries and migrations would need porting.
- **Socket.IO's Redis adapter,** so an update made on one server reaches phones connected to another.
- **The in-memory Games:** either route each Game to one server (sticky by Game id) or stop caching them.
- **Photos and Theme images** in object storage (DigitalOcean Spaces), not on local disk.

- **The statistics and feedback** (ADR-0005) need care in a move like this:
  - the peak "screens watching at once" is counted per server process, so with several servers it would undercount until it reads the count from the Redis adapter;
  - the feedback follow-up emails are sent from a timer in every process, so they'd go out twice unless one server is made the only sender (or a row is claimed before sending);
  - the queries are Drizzle's and mostly portable, but the follow-ups find ended Games by a text match on the event log (`like '%"type":"GameEnded"%'`), which should become a real column first.

#### A cheaper path: one server per Game (Jim's idea, 2026-11-21; not scheduled)

Rather than every server sharing one database, each server keeps its own Games whole: their events, Players, Gifts, Posts, Photos and votes, in its own SQLite file and photo folder. Caddy sends each request to the server that holds its Game. A party is at most a few hundred phones, so no single Game outgrows a server; it's the number of Games that grows. This keeps SQLite, skips Postgres and Redis, and a server that fails takes down only its own Games.

**What already fits:**
- Everything about a Game is under `/api/games/:id/...` and the page `/games/:id`, so Caddy can route by the id in the path.
- Photos are already kept in a folder per Game.

**What it would take:**
- **The server in the id (done 2026-11-21).** Every new Game's id starts with its server's tag: `a.` + the random part on the first server (`SERVER_TAG`, default `a`). Games made before 11/21 have no tag. A second server would run with `SERVER_TAG=b`. Caddy matches it with a path regex, so there's no lookup table. Untagged Games stay on the first server. Which server new Games go to is a Caddy setting: the route for `POST /api/games`, the one request that has no Game id yet.
- **The live connection (done 2026-11-21).** Screens now name their Game in the connection's URL (`/socket.io/?game=<id>`), where Caddy can route it, and its polling requests stick to the same server. Pages loaded before the change still send it in the handshake body, which the server also accepts.
- **Sign-in, shared.** Sessions live in one server's database. Either the session cookie becomes a signed token any server can check with a shared secret, or one server is the sign-in server and the others ask it.
- **Things that span Games stay on the first server:** Hosts' Game lists (`GET /api/games` must gather from every server, or each server reports its Games to the first), Organizations and their Theme images, Co-hosts' lists, the contact form, `/admin`. Making a Game with an Organization's Theme on the new server needs the first server's say-so.
- **Statistics:** every server needs the same statistics key (`app_keys`), or people would be counted twice. `/admin/stats` sums the servers. The feedback follow-ups are fine as they are, since each server sends only for its own Games.
- **Backups and deploys:** per server, as today, just run on each.

**How long:** about a week, roughly half the shared-database path below. **When:** only if the load test, and then December's traffic, show one well-sized box isn't enough. The two cheap first steps (the tag, the Game in the connection URL) are done; they change nothing on one server.

**How it would grow (Jim, 2026-11-21):** one server running Caddy and the app; then server 2, with new Games sent to it; then server 3, and so on. Once the first server is busy, it takes no new Games and its own Games end one by one, so it becomes the Caddy server plus everything that isn't about one Game: sign-in, Organizations and Themes, Hosts' Game lists, the contact form, `/admin`. Caddy itself is light (it passes requests on); what loads the first server is the app, so moving new Games elsewhere is what frees it.

#### Watching the servers (built 2026-11-21 for one server)

`/admin/system` (Admin → 🩺 System) shows each server's health, with what's wrong in words. It refreshes every 30 seconds. The server's half is `GET /api/admin/system`, with the readings and the warning rules in `packages/server/src/system.ts`.

- **Each server reports:** its tag and build; screens connected now and the peak since it started; Games being watched and Games kept in memory; the event loop's delay; whether the overload guard is turning new Games away; memory against the container's limit; free disk; photo bytes; the age of the last backup; how long it's been up.
- **It warns** at: the event loop past half `MAX_LAG_MS`, screens at 80% of `MAX_SCREENS`, memory at 85% of the limit, disk under 10% free, or no backup for 36 hours.
- **With more servers (not built):** the first server asks the others, rather than the others registering with it. Caddy's config is already the list of servers, since a server gets traffic only once it's added there, so the first server's `.env` would carry the same list (`SERVERS=b=10.0.0.12,...`, tag and private address). For each, it calls a stats endpoint reachable only on the private network, or with a secret shared between the servers. A server that doesn't answer shows as down at once, with no heartbeats to time out. The page already takes a list of servers, so it needs no change.

#### The shared-database path

**How long:** two to three weeks (more tables than when this was first written). **What users notice:** nothing, if it's cut over on a quiet weekday. A cheaper middle step comes first: a much bigger single droplet. That likely covers 1,000 Organizations, since the load is mostly idle phones.

## Keeping the data (reviewed 2026-11-18, after the statistics and feedback)

The goal: whatever we change, whatever server it runs on, no Game, Photo, statistic or piece of feedback is lost.

**What lives where:**

| What | Where | Backed up by |
|---|---|---|
| Games (their event logs), Players, Gifts, posts, votes | the SQLite file `/data/elephant.db` | `backup.sh` (the whole file) |
| Hosts, Organizations, sessions, the tip-note checkbox | the same file | the same |
| Statistics: `game_stats`, `people_stats`, `org_stats`, `ref_visits`, `game_features`, `daily_counts` | the same file | the same |
| Feedback and the follow-up log: `feedback`, `feedback_emails` | the same file | the same |
| **The statistics key** (`app_keys`): the secret that turns an email into the hash the statistics count people by | the same file | the same |
| Photos and Theme images | `/data/photos`, `/data/themes` | `backup.sh` (latest copy) |
| Settings and secrets: `RESEND_API_KEY`, `ADMIN_EMAILS`, `SIGNIN_LINKS_PER_DAY`, `DOMAIN`, `MAIL_FROM` | the droplet's `.env` | **nothing**: keep a copy in the password manager |
| The HTTPS front door | ww-edge's `caddy/sites/elephant-exchange.caddy` | the ww-edge repo |

Because everything but `.env` is one file plus two folders, one backup carries all of it to a new server. Three things to get right:

- **Never let the statistics key change.** If `app_keys` were lost or a fresh database started, people already counted would be counted again as new (unique people, returning Hosts and the funnel would all jump). Restore the old database rather than start empty, and in a move to Postgres, copy `app_keys` with the rest.
- **The deleted stays deleted, the counted stays counted.** The statistics tables are deliberately kept when Games and Organizations are deleted. A restore from an older backup brings back Games deleted since; that's expected, and the Host can delete them again.
- **Restore with the script, not by hand.** SQLite runs in WAL mode: copying a database over the old one while its `-wal` file is still there can replay the old writes onto it. `scripts/restore.sh` removes them first.

### Moving to a new server (bigger droplet, own droplet, or after losing one)

About an hour, most of it waiting. Do it on a weekday morning, never a party night.

1. On the old server, if it's up: `./scripts/backup.sh`, then from Omarchy `./scripts/pull-backups.sh`. Stop the app (`docker compose stop app`) so nothing is written after the backup.
2. On the new server: Docker, ww-edge (or a plain Caddy), the `edge` network, `git clone` this repo to `~/ww/elephant-exchange-v2`, and its `.env` from the password manager (`chmod 600`).
3. From Omarchy: `DEPLOY_HOST=<new> ./scripts/deploy.sh` ships the image and starts it on an empty database (no backup is taken, since nothing was running).
4. Copy the backup up: `rsync -a ~/elephant-backups/ <new>:ww/elephant-exchange-v2/backups/`.
5. On the new server: `./scripts/restore.sh backups/elephant-<newest>.db`.
6. Check `/admin/stats` shows the same totals as before, and open a Game with Photos.
7. Point Cloudflare's A record at the new server (proxied, so it switches in a minute or so). Add the cron line from `backup.sh`.
8. Keep the old server, stopped, for a week before destroying it.

What users notice: a minute or two of "can't connect" during step 7; phones reconnect by themselves. A party in progress during a move would lose moves made after step 1, which is why it's never done on a party night.

## Before the launch post

- [ ] Resend paid plan, and raise `SIGNIN_LINKS_PER_DAY` (limit 1).
- [ ] Check the droplet's headroom (`free -h`, `df -h`, `docker stats`) and raise EE's `mem_limit` if there's room (limit 2).
- [x] An uptime monitor on `/api/health` (limit 3): UptimeRobot, every 5 minutes, emails Jim.
- [x] Copy `backups/` off the droplet on every deploy, and a restore script (limit 3).
- [ ] Check the droplet's nightly backup cron line is in (`crontab -l`) (limit 3).
- [x] DigitalOcean droplet backups (Jim believes they're on, about $4 a month; confirm under Droplet → Backups).
- [ ] A copy of the droplet's `.env` in the password manager.
- [x] The Feed, Photo, memory and overload fixes (see "Peak-season plan").
- [ ] Load test, then set `MAX_SCREENS` and `MAX_LAG_MS` from it.
- [ ] Its own droplet for the season, before 11/30.
- [ ] No deploys on party evenings (Fri/Sat from 4 pm Pacific) in December. Tabs already open keep running the old code until they're reloaded.

## Watch list for December

- `/admin/system`: everything below at a glance (memory, screens, the event loop, backups, restarts as "up for").

- Resend dashboard: emails a day against the plan.
- `docker stats elephant-exchange`: memory against `mem_limit`.
- `/admin`: how many Games are under way at once.
- Restarts: `docker inspect -f '{{.RestartCount}}' elephant-exchange`.
