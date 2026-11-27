# Demo cleanup and counting: plan (2026-11-27)

Jim's four asks, in priority order. Two PRs: **A** (#3, the counting fix, needed before LinkedIn Post 2 on Monday
11/30) and **B** (#1 and #2, the cleanup and the demo counter). Neither is deployed until Jim says.

## #3: demo and ?ref= visits aren't counted (PR A)

### What the numbers say (production backup, 2026-11-27 17:07 UTC)

| Day (UTC) | Visitors | Front | Demo | Other | From your links | Demo visitors (sessions) | ref_visits |
|---|---|---|---|---|---|---|---|
| 11/23 | (none) | | | | | 1 | linkedin 2 |
| 11/24 | 108 | 20 | 0 | 76 | 1 | 1 | ted 1 |
| 11/25 | 119 | 54 | 0 | 55 | 0 | 4 | |
| 11/26 | 149 | 40 | 0 | 109 | 0 | 0 | |
| 11/27 | 77 | 32 | **8** | 36 | **8** | 1 | **facebook 8** |

Today's Facebook visits *were* counted, so no redirect is dropping the `ref` and the counter isn't broken
outright. What's wrong is what it counts.

### Why

1. **Only the first page of a visitor's day is looked at.** `visitors.arrived()` (visitors.ts) records the landing
   page and the `ref` only when the browser is new that day; on a later page it returns `"again"` at once. The
   existing test even asserts it ("already counted").
   - **Demo:** someone who lands on the front page and taps **Try a Demo** or **▶ Watch a swap play out** moves
     inside the app, with no page load the server sees. They count as **Front**, never **Demo**. That's 11/24–25:
     6 demo games, 0 in Demo.
   - **From your links:** someone who opened the site earlier that day (from a bookmark, a DM, the front page)
     and later taps the post's link isn't counted as coming from it.
2. **The guided tour counts as Other.** `landingOf()` knows `/try`, `/sample` and `/games/:id/demo`, but not
   `/guided/...`. Post 2's link (`/guided/happy-path?autoplay&ref=linkedin`) would have landed in **Other**.
3. **The per-source table (`ref_visits`) uses another rule.** It's fed by the browser (`noteArrival` in api.ts,
   `POST /api/stats/visit`), once per browser per source *for good* (remembered in localStorage). So it can't
   agree with the daily visitor numbers, and someone who saw the LinkedIn post Monday and the Facebook one Friday
   is counted for Facebook only if they're in a fresh browser.
4. **11/23 has no visitor numbers at all:** the counter was deployed that evening (UTC 11/24). Nothing to fix.

### The fix

Keep the privacy design as it is (a keyed hash of address and browser with the day's secret, no cookie, deleted the
next day), and count each of these **once per visitor per day, on whatever page it happens**:

| Count | When | Shown as |
|---|---|---|
| `visitors` and the landing (front/demo/game/other) | first page of the day (as now) | Visitors, and "First landed on" |
| `visitors:triedDemo` | the visitor reaches the demo: `/try`, `/sample`, `/guided/…`, `/games/:id/demo`, by a page load *or* a tap inside the app | **Tried the demo** (new column; the tile, too) |
| `visitors:fromLinks` | a page with `?ref=` (any page of the day, not just the first) | From your links |
| `ref_visits` (per source) | the same, per source: a visitor who comes from LinkedIn and Facebook on one day counts once for each | Where people came from |

- `/guided/…` becomes a **demo** landing too.
- The browser tells the server when it moves to a demo page inside the app (`POST /api/stats/visit` with
  `{ demo: true }`; it already posts `{ ref }`). The server applies the same rules as page loads: robots and admins
  aren't counted, and the day's fingerprint decides "once". The browser stops keeping its own once-ever list.
- The "Demo" landing column stays (it's where people *landed*); the new "Tried the demo" column is the one to watch.

### Tests

- visitors.test.ts: a visitor who lands on `/` and then reaches the demo counts once in Tried the demo, however many
  times; `/guided/happy-path?autoplay&ref=linkedin` lands as demo, from links, and in `ref_visits` as linkedin; a
  `?ref=` on a later page that day still counts; two sources in a day count once each; admins and robots don't.
- Over HTTP: the page load `GET /try?ref=facebook` and the browser's `POST /api/stats/visit` together count it once.
- Web: moving to `/try` inside the app posts `{ demo: true }`.

Jim's check after deploy: open `/try?ref=facebook` in a private window. On the Stats page, Visitors, Tried the
demo, From your links, and facebook under Where people came from each go up by one (by 0 if that private window
already counted today, since the address and browser are the same).

## #1: delete old demo games (PR B)

- **Admin → Games:** a **Delete demo data** button beside Delete test data.
- **Dry run first:** pressing it asks the server for counts (`GET /api/admin/demo-data`) and shows
  "N demo games, M visitor accounts, X photos. Delete them?" with **Yes, delete demo data** / **Keep them**.
- **What goes:** every Game flagged demo whose **host** (role host in `game_hosts`) is a `visitor-…@visitors.invalid`
  account, with everything a Game deletion already removes (players, gifts, posts, photos, reactions, votes);
  then those visitor accounts and their sessions. The same path the hourly sweep uses (`sweepVisitors`), with no
  age cutoff, except:
  - a visitor whose account is under an hour old is left alone, so nobody's demo vanishes mid-swap;
  - a demo Game hosted by a real signed-in account (Jim's own demos) stays, as do all real Games ("Holiday fun",
    ted@novuz.com, and any Game with a real host). A test proves it with a real Game and a real Host's demo.
- **Backup first, built in:** the delete takes a backup (`backup.ts`, into the backups folder the System page
  shows) before deleting anything, and the result names it: "Backed up to elephant-…db. Deleted 8 demo games…".
  If the backup fails, nothing is deleted.
- **Stats stay:** deleting doesn't change Games stats or the counter in #2 (ADR-0005: usage stats outlive deletes).

## #2: "Demos started" (PR B)

- A durable daily count, `demosStarted`, in `daily_counts` (the table the visitor numbers use), so deleting
  demo games never changes it. It starts at 0 on the deploy day; no backfill.
- **What counts as a demo started:**
  - a demo Game created from **Create demo game** (on /try or a Host's home), and
  - a guided tour started: counted once, when the tour builds its first Game. **Back** and **Restart** build
    fresh Games, and those aren't counted.
  The two are kept apart (`demosStarted:self`, `demosStarted:guided`) and shown as one number with the split.
- Shown on Stats → Insights beside "Demo visitors": **Demos started**, today · last 14 days · since it started.
- Demo Games stay out of the Games stats, as now.

## #4: should demo games expire? (Jim's decision)

**Decided 2026-11-27: a visitor's demo Game is deleted 48 hours after its last move or Post** (`DEMO_GAME_HOURS`,
`expireDemoGames` in the hourly sweep). The visitor stays until `VISITOR_DAYS` (7), so their home still offers to
host a real one. A signed-in Host's own demos aren't expired. What follows is the question as it was put.

**They already do.** The server's hourly sweep (`sweepVisitors` in server.ts) deletes every demo visitor more than
`VISITOR_DAYS` = 7 days old, with the demo Games they host. The 11/23 visitor goes on 11/30, by itself. So the pile
is never more than a week deep; #1 clears it now rather than on a rolling 7 days.

The open choices are:

1. **Keep 7 days** (no change).
2. **Shorten it**, to 1–2 days. The visitor's session cookie lasts as long (`VISITOR_DAYS` sets both), so someone
   who comes back to their demo the next day would find it gone after a day.
3. **Expire the Game sooner than the visitor:** for example, delete a demo Game 24 hours after its last move, but
   keep the visitor (so their home page still offers to host a real one).
4. **Also expire demo Games hosted by real accounts** (Jim's own), which the sweep never touches now.

The guided tour makes many short-lived demo Games (one per Back or Restart). They're swept with their visitor.
