# Inviting people, and the welcome screen

_Jim, 2026-11-24, after an hour walking Tirth through the app._

## What went wrong

Tirth made a Game; Jim followed its QR code. The phone opened on the Gifts tab: "Waiting for the Host to start", "No Gifts opened yet", and nothing to do. Nothing offered a way to join or sign in:

- The Game was Host-entered (the default), so there was no "Playing? Join the Game" button.
- The top bar's Sign in is hidden on every Game page (so nobody signs out by mistake mid-party).
- The You tab said "The Host enters the Players" with no form.
- The only email box was on the 📷 Post tab, as "Sign in to post", with nothing pointing to it.

Tirth's own phone, not signed in yet, was in the same spot: the app couldn't know he was the Host. And signing in from the top bar's Sign in (on other pages) lands on the home page, not back in the Game.

Tirth liked people signing themselves up from their phones (no typing names for the Host), and asked for a way to invite people ahead of the party.

## Identity

ADR 0007: a person in a Game is their email address, proved by a link they clicked. Watching needs nothing; posting, playing from a phone and changing your Name need a confirmed email.

## Phase 1: the welcome screen and the shared invitation (built 2026-11-24)

1. **Welcome screen.** Anyone not signed in who opens a Game's link (QR code, Invite link, a forwarded email) gets a welcome first: the Game's name, tagline, **When & where**, and a form:
   - Name (as everyone will see it) and email address.
   - **"I brought a gift"**, in a Self sign-up Game. Ticked: they'll join as a Player. Unticked: they're a Guest who can chat and post. In a Host-entered Game there's no box; the screen says the Host adds the Players, so a Player tells the Host they're there (until Phase 2 matches them by email).
   - **Send me a link.** The screen says to check spam.
   - **Just watch:** no email, straight to the Game (the Gifts, who's up, the Chat). The You tab offers the same form again later.
   - **Hosting this Game?** A line saying the Host signs in here too, to get the console on this device.
2. **Back where they were, joined.** The link returns them to the Game with what they asked for in the address (`?as=player&name=Ann`), so it works even when the mail app opens it in its own browser. On arriving signed in, the Game joins them as a Player or sets their Guest Name, once, then tidies the address.
3. **Waiting for the start.** Signed in before the Game starts, the phone says "You're in as Ann" (Player or Guest) and "Waiting for the Host to start", with When & where.
4. **When & where.** An optional line the Host sets with the name and tagline (Game settings), such as "Fri Dec 12, 10 am · Conference room B". Free text: no time zones to get wrong. Shown on the welcome screen and the phones' header until the Game starts.
5. **Copy invitation.** The Invite dialog gets "Copy invitation": a few lines with the Game's name, When & where and the link, for the Host to paste into their own email or chat to the team. The Host's own email reaches people far better than one from an address they don't know, and costs the app nothing.

Built in `packages/web/src/Welcome.tsx` (tests: `test/welcome.test.tsx`). Someone signed in already gets the same form without the email. The Host's phone console has Copy invitation beside 🔗 Link for guests.

Not in Phase 1: the top bar's Sign in on other pages still lands on the home page.

## Phase 2: personal invitations (after the party)

1. **Guest list by email.** In setup, the Host pastes names and emails ("Ann Lee, ann@corp.com"). Each becomes a Player with that email. Whoever signs in with it, by any route (shared link, QR code, personal invitation), *is* that Player: no claiming. In a Host-entered Game this is also how "I brought a gift" becomes a Player.
2. **Send personal invitations** (optional): one email each, with a link good until the Game ends, on more than one device. It never carries a Co-host's role (ADR 0007).
3. **Who's in.** The Roster shows each Player as invited, joined, or not yet, so the Host can nudge someone or resend.
4. Risks: sending many emails from the app (the mail service's daily limit; cold emails to company addresses hurt its reputation and land in spam). A Player whose invitation is lost still gets in by the shared link with the same email.

Open: whether someone who isn't on a Host-entered Game's list and ticks "I brought a gift" can ask to be added (one tap for the Host to approve).
