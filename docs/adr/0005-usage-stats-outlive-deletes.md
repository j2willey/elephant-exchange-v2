# Usage statistics are kept apart from the Games, outlive deletes, and know people only by a keyed hash

Jim wants to know how the app is used once it's public: how many Hosts, Organizations, Games and people, how long Games run, and where people came from. Those numbers have to hold up when Hosts delete their Games and Organizations, which removes everything kept for them, and they must leave out the test Games that Jim, the smoke test and Claude make.

So the statistics live in their own tables (`game_stats`, `people_stats`, `org_stats`, `ref_visits`), which nothing deletes. A Game's row is brought up to date from its log whenever the admin opens the Stats page, and once more just before the Game is deleted; an Organization's is marked deleted, not removed. Opening the page also fills in anything missing, which was the backfill for what came before.

People are counted by an HMAC of their email under a key the app makes for itself on first start (`app_keys`). The same person always gets the same key, so they're counted once however often they sign in or delete things, but the tables never hold an address. Hosts are shown by email on the Stats page only while they're still users, by matching their key.

A Game counts once it was really played: started, with at least 4 Players and 3 Picks. Demos, Games hosted from an `@example.com` address, and Games Jim excludes by hand on the Stats page are left out. A Game's length runs from its first Pick to End Game, since Games are often set up days before. A second figure leaves out any gap of over 30 minutes between moves, for parties that stop for dinner.

Where people came from is the `?ref=` on the link they followed. The browser keeps the first one and sends it with the sign-in request, and each source is counted as a visit once per browser.

We chose this over working the numbers out from the live tables, which lose a Game's history when it's deleted, and over an outside analytics service, which would mean a third party seeing every visitor.

## Consequences

- Opening the Stats page replays every Game's log. That's quick for hundreds of Games; with many thousands it would want a cache or a nightly job.
- The key that makes the hashes is in the database, so a stolen database plus a guessed email could confirm someone used the app. The `users` table already holds addresses, so this adds no new exposure.
- Counts like Posts and Photos never go down, even after old Photos are swept away.
