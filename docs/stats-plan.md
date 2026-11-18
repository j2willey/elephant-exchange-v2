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

## Phase 2: insights, after launch

The counts these need are already recorded per Game (steals, Final Round, Posts, Photos, votes, Co-hosts). What's left is reading and showing them.

- **Funnel:** signed in → created a Game → started → finished → ran the vote. It shows where Hosts give up.
- **Party size and engagement:** Players per Game, the share on their own phones, and the most phones connected at once (needs a small counter in the live-update code).
- **Gameplay:** steals per Game, frozen Gifts, Final Round and vote use, average turn time, undos and skips (a high count points at a confusing screen).
- **Features used:** Posts, Photos, Organization Themes, Co-hosts, roster paste, self sign-up, scoreboard modes.
- **Returning Hosts:** who runs a second Game.
- **When Games happen:** by day of week and hour, for the scale plan and the no-deploy windows.
- **Running costs:** sign-in emails per day against the cap, and photo storage used.
- **Charts:** Games per week, and the funnel.

## Phase 3: asking Hosts and guests what they think

- **The Host, after End Game:** a small "How did it go?" card on the console: 1–5 stars, "Would you use it again?", an optional comment, and the existing "OK to contact me" box. Asked once per Game, never mid-game.
- **Guests, after the vote:** on their phones, a one-tap 👍 or 👎 with an optional comment. Never shown while the Game is under way.
- **A follow-up email** a day or two later, only to Hosts who ticked "OK to contact me", with a link to the same short form. It uses the sign-in email allowance, so it's sent sparingly.
- **A "Suggest something" box** on the Host's home page, for ideas at any time.
- **An admin Feedback page:** the answers, newest first, with each Game's rating beside its row in the Stats, and an average rating over time.
- **Ground rules:** one ask per Game per person, nothing on the scoreboard, no email unless they opted in, and comments kept with the person's hashed key, not their address, once they're no longer a user.
