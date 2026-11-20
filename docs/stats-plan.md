# Stats and feedback plan

Planned 2026-11-18, ahead of the public launch (about 2026-11-24). How the statistics are kept is in [ADR-0005](adr/0005-usage-stats-outlive-deletes.md).

## Phase 1: the basics, before the launch post (built)

- Hosts, Organizations, and Games per Host and per Organization.
- Games created, played and finished, across the system, without demos, test accounts, try-outs or Games excluded by hand.
- Unique people who signed in, and Players in played Games, on their own phones or not.
- Game length from the first Pick to End Game, and the same leaving out breaks; averages overall and per Host.
- Where people came from: `?ref=` on shared links (visits, and sign-ins credited to the first source).
- All of it outlives deleted Games and Organizations.

**Links to share:** `https://elephantexchange.app/?ref=linkedin`, `?ref=facebook`, `?ref=email`, and so on. Any plain word works.

## Phase 2: insights (built)

On the same Stats page (`/admin/stats`), over played Games unless it says otherwise:

- **Where Hosts drop off:** signed in → created a Game → started one → finished one → ran the vote, with the share of those who signed in.
- **Played Games per week** (the last 12), and **when Games start** by day of the week and hour, in the viewer's time zone.
- **Parties and play:** Players per Game, the share on their own phones, the most screens watching at once (phones, the scoreboard and the console), steals and frozen Gifts per Game, seconds per Pick (breaks left out), Final Round and vote use, undos and skips per Game, and returning Hosts.
- **Features used:** Posts, Photos, an Organization's look, a Game's own look, Co-hosts, self sign-up, roster paste, scoreboard modes.
- **Running costs:** sign-in emails today and on the busiest of the last 14 days, against the daily cap (with a warning at 80%), and the space Photos take.

What's recorded for it: undos, skips, frozen Gifts, vote use and self sign-up are read from each Game's log; the most screens at once is noted as they connect; features the log doesn't show are noted as they're used (roster paste is reported by the browser); sign-in emails are counted a day at a time, since the links themselves are cleared after a day. An undone steal doesn't count as a steal.

## Phase 3: asking Hosts and guests what they think (built)

- **The Host, after End Game:** a "How did it go?" card on the console (laptop and phone): 1–5 stars, "Would you use it again?" (yes, maybe, no) and an optional comment. Asked once per Game; they may change their answer.
- **Guests, once it's over and the vote isn't under way:** on their phones, 👍 or 👎, then an optional comment. Only for guests who are signed in, never mid-game, never in a demo.
- **A follow-up email** a day after the Game ends (up to a week after), only to a Host who ticked "OK to contact me" and hasn't answered yet; once per Game, ever. It links back to the Game, where the card is waiting. Follow-ups never use more than half the day's email allowance (counting sign-in links), at most 10 an hour, so sign-ins come first.
- **"Suggest something"** on the Host's home page, for ideas at any time.
- **The admin's Feedback page** (`/admin/feedback`): the average Host rating, "would use again" and guest thumbs, the number of suggestions, then every answer, newest first. Each Game's rating also shows in the Stats page's Games table.
- **Kept like the statistics:** nothing is cleared when a Game is deleted, and people are stored only as a keyed hash of their email (shown by email on the admin pages while they're still users). Test accounts' answers are left out of the figures.

## Phase 4: how Games are set up, records and testimonials (built 2026-11-20)

- **How Games are set up** (Stats page): Games by recommended, customized or saved settings (and who opened the full list first); each setting's values at creation and in played Games, and how many played Games changed it afterwards; the turn timer against real Turn times (call-up to Pick, breaks left out) and how often Turns ran past it.
- **Records** (Stats page): the top 5 played Games for most Players, longest play time (ended Games, breaks left out), most Steals, most screens at once and most Photos, each with its date, Players and length. For lines like "the biggest party so far had 60 Players".
- **Testimonials:** under a Host's or guest's comment, "You may quote this on the Elephant Exchange website" and an optional name to show with it. Nothing is public until the admin chooses "Put it on the website" on the Feedback page; the front page then shows it under "What people say" (hidden while there are none). Changing the words or the name, or unticking the OK, takes it down until the admin publishes it again. Only the words and the name given are ever shown, never an email.
