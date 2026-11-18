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

### 4. Games kept in memory

- **Today:** the server rebuilds each Game from its log once and keeps it in memory (`cache` in `server.ts`). It forgets a Game only when the Game is deleted. Each Game is small (kilobytes), so even thousands would fit. But memory grows with every Game opened since the last restart.
- **What we'd see:** memory slowly creeping up over a busy December, then a restart.
- **The change:** forget Games that ended, or that haven't moved in a day. A Game that's opened again is simply rebuilt from the database. About an hour, with a test. Users notice nothing.

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
- [ ] An uptime monitor on `/api/health` (limit 3).
- [x] Copy `backups/` off the droplet on every deploy, and a restore script (limit 3).
- [ ] Check the droplet's nightly backup cron line is in (`crontab -l`), and turn on DigitalOcean droplet backups (limit 3).
- [ ] A copy of the droplet's `.env` in the password manager.
- [ ] No deploys on party evenings (Fri/Sat from 4 pm Pacific) in December. Tabs already open keep running the old code until they're reloaded.

## Watch list for December

- Resend dashboard: emails a day against the plan.
- `docker stats elephant-exchange`: memory against `mem_limit`.
- `/admin`: how many Games are under way at once.
- Restarts: `docker inspect -f '{{.RestartCount}}' elephant-exchange`.
