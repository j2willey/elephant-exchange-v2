# A person in a Game is their email address, proved by a link they clicked

Anyone who posts, plays from their phone, or changes their own Name is one person, and the app must tell them apart: only Ann may post as Ann, take Ann's Turn on her phone or rename Ann. The app knows who someone is by their email address, and it believes the address only once they've clicked a link mailed to it. That's the emailed sign-in link today, and later it can be a personal invitation (`docs/invite-plan.md`, Phase 2), which is the same proof: only someone with Ann's inbox has Ann's link.

So:

- **Watching needs no email.** Anyone with the Game's link or QR code sees the Gifts, who's up and the Chat.
- **Posting, playing from a phone and changing your own Name need a confirmed email.** It's one per person per Game: a person is one Player or one Guest (`game_players`, `game_names`).
- **The Host and Co-hosts are emails too** (`game_hosts`), so the Host signs in on a second device the same way as anyone, and gets the console there.
- **The Host can name anyone**, with or without an email, and lock a Name (CONTEXT.md, "Name"). A Player the Host typed in, with no email, has no phone of their own in the Game. The Host enters their Turns.

We chose this over typing an email without confirming it, which anyone could use to post as someone else, or to sign in as a Co-host, whose role is given by email. We also chose it over a name and a code on the Scoreboard (the code is on the TV for the whole room to see) and over passwords (a party guest won't make an account for one evening). The cost is a trip to the inbox, which may put the link in spam. The welcome screen says to check spam, and lets the guest watch while they wait.

## Consequences

- The welcome screen on the Game's link asks for an email, a Name and whether they brought a gift, and sends the sign-in link. The link brings them back to the Game, joined, wherever they opened it: what they asked for travels in the link's return address, not in the browser that asked, since the link often opens in the mail app's own browser.
- An email on the Roster (the guest list) makes whoever signs in with it that Player, by any route: a personal invitation, the shared link or the QR code.
- A personal invitation signs its person in once, until the Game ends. Opened again (a second device, or forwarded), it signs nobody in and offers a sign-in link to the address it went to, so a forwarded invitation can't let anyone else in once its owner has used it. It never signs in anyone who is a Host or Co-host of any Game, whose role needs a sign-in link, and isn't sent to a Co-host of the Game.
