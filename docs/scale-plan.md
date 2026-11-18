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
  - A nightly backup on the droplet, plus a backup before every deploy (`scripts/deploy.sh`).
  - Copies off the droplet only when someone rsyncs them.
- **What we'd see:** if the droplet dies, the site is down until it's rebuilt. We'd lose everything since the last off-droplet copy.
- **The change (do now, it's cheap):**
  - Rsync `backups/` to Omarchy after each deploy and weekly in December.
  - Add a free uptime monitor (an UptimeRobot-style check of `/api/health`) that texts on an outage.
  - Write a restore-to-a-new-droplet runbook and rehearse it once, about an hour.
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

**How long:** one to two weeks. **What users notice:** nothing, if it's cut over on a quiet weekday. A cheaper middle step comes first: a much bigger single droplet. That likely covers 1,000 Organizations, since the load is mostly idle phones.

## Before the launch post

- [ ] Resend paid plan, and raise `SIGNIN_LINKS_PER_DAY` (limit 1).
- [ ] Check the droplet's headroom (`free -h`, `df -h`, `docker stats`) and raise EE's `mem_limit` if there's room (limit 2).
- [ ] An uptime monitor on `/api/health`, and rsync `backups/` off the droplet (limit 3).
- [ ] No deploys on party evenings (Fri/Sat from 4 pm Pacific) in December. Tabs already open keep running the old code until they're reloaded.

## Watch list for December

- Resend dashboard: emails a day against the plan.
- `docker stats elephant-exchange`: memory against `mem_limit`.
- `/admin`: how many Games are under way at once.
- Restarts: `docker inspect -f '{{.RestartCount}}' elephant-exchange`.
