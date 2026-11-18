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

## Phase 3: asking Hosts and guests what they think

- **The Host, after End Game:** a small "How did it go?" card on the console: 1–5 stars, "Would you use it again?", an optional comment, and the existing "OK to contact me" box. Asked once per Game, never mid-game.
- **Guests, after the vote:** on their phones, a one-tap 👍 or 👎 with an optional comment. Never shown while the Game is under way.
- **A follow-up email** a day or two later, only to Hosts who ticked "OK to contact me", with a link to the same short form. It uses the sign-in email allowance, so it's sent sparingly.
- **A "Suggest something" box** on the Host's home page, for ideas at any time.
- **An admin Feedback page:** the answers, newest first, with each Game's rating beside its row in the Stats, and an average rating over time.
- **Ground rules:** one ask per Game per person, nothing on the scoreboard, no email unless they opted in, and comments kept with the person's hashed key, not their address, once they're no longer a user.
