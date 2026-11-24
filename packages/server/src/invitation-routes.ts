import { phase, roster } from "@elephant/rules";
import { eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import type { Access } from "./access.js";
import type { createAuth, Mailer } from "./auth.js";
import { gameHosts, type Db } from "./db.js";
import type { LoadedGame } from "./game-store.js";
import { parseBody } from "./http.js";
import { emailHint, type People } from "./people.js";
import { invitationsBody, linkRedemption } from "./schemas.js";

/**
 * Personal invitations (ADR 0007, docs/invite-plan.md Phase 2): the Host emails each Player on the guest list a
 * link of their own. It signs them in once, until the Game ends, and takes them to the Game as that Player. Opened
 * again (another device, or forwarded), it signs nobody in and offers a sign-in link to the address it was sent
 * to. It never signs in a Host or Co-host, whose role needs a real sign-in link.
 */
export function invitationRoutes(deps: {
  access: Access<LoadedGame>;
  auth: ReturnType<typeof createAuth>;
  mailer: Mailer;
  baseUrl: string;
  db: Db;
  people: People<LoadedGame, object>;
  /** The Game, or undefined if it's gone. */
  load: (id: string) => LoadedGame | undefined;
  staffChanged: (id: string) => void;
  /** Sets the session cookie, as a sign-in link does. */
  startSession: (c: Context, sessionToken: string, email: string) => void;
  clientIp: (c: Context) => string;
}) {
  const { access, auth, mailer, baseUrl, db, people, load, staffChanged, startSession, clientIp } = deps;
  const routes = new Hono();

  /** Whether this address runs any Game: such a person signs in with a link, never an invitation. */
  const isStaffAnywhere = (email: string) => db.select({ email: gameHosts.email }).from(gameHosts).where(eq(gameHosts.email, email)).limit(1).get() !== undefined;

  // The Host or a Co-host emails invitations: to the Players named, or to everyone listed who isn't in or invited yet.
  routes.post("/api/games/:id/invitations", access.need("staff", "Only the Host and Co-hosts can send invitations"), async (c) => {
    const { id } = c.var.access;
    const body = await parseBody(c, invitationsBody);
    if (!body.ok) return body.res;
    if (!mailer.sendInvitation) return c.json({ error: "Invitations can't be emailed from this server" }, 503);
    const game = load(id)!;
    if (phase(game.state) === "ended") return c.json({ error: "The Game is over" }, 409);
    const listed = people.guestList(id, game);
    const named = body.data.playerIds;
    const to = named ? listed.filter((g) => named.includes(g.playerId)) : listed.filter((g) => !g.joined && g.invitedAt === null);
    const nameOf = (playerId: string) => roster(game.state).find((p) => p.id === playerId)?.name ?? "";

    const sent: string[] = [];
    const notSent: { playerId: string; reason: string }[] = [];
    for (const { playerId, email } of to) {
      if (people.roleIn(id, email)) {
        notSent.push({ playerId, reason: "Hosts and Co-hosts sign in with a link" });
        continue;
      }
      const token = auth.issueInvitation(id, email);
      if (!token) {
        notSent.push({ playerId, reason: "That's all the emails the app can send today" });
        continue;
      }
      try {
        await mailer.sendInvitation(email, { gameName: game.name, tagline: game.tagline, whenWhere: game.whenWhere, name: nameOf(playerId), url: `${baseUrl}/invite?token=${token}` });
        sent.push(playerId);
      } catch (err) {
        console.error("Couldn't send an invitation", err);
        auth.withdrawInvitation(token);
        notSent.push({ playerId, reason: "The email couldn't be sent just now" });
      }
    }
    if (sent.length) staffChanged(id);
    return c.json({ sent, notSent });
  });

  /** Whether an invitation may still sign its person in (see auth.redeemInvitation). */
  function allowed(gameId: string, email: string): "ok" | "staff" | "gone" {
    const game = load(gameId);
    if (!game || phase(game.state) === "ended" || !people.playerOf(gameId, email, game)) return "gone";
    return isStaffAnywhere(email) ? "staff" : "ok";
  }

  // Opening an invitation: the web app's /invite page sends its token (a GET that signed people in would be used
  // up by email scanners that open every link).
  routes.post("/api/auth/invitation", async (c) => {
    const body = await parseBody(c, linkRedemption);
    if (!body.ok) return body.res;
    const opened = auth.redeemInvitation(body.data.token, allowed);
    if (!opened) return c.json({ error: "This invitation has expired" }, 401);
    if ("refused" in opened) return c.json({ refused: opened.refused, gameId: opened.gameId, hint: emailHint(opened.email) }, 409);
    startSession(c, opened.signedIn.sessionToken, opened.signedIn.email);
    return c.json({ email: opened.signedIn.email, gameId: opened.gameId });
  });

  // An invitation already used (or a Host's): a sign-in link to the address it went to, back to the Game.
  routes.post("/api/auth/invitation/link", async (c) => {
    const body = await parseBody(c, linkRedemption);
    if (!body.ok) return body.res;
    const invitation = auth.invitationOf(body.data.token);
    if (!invitation || allowed(invitation.gameId, invitation.email) === "gone") return c.json({ error: "This invitation has expired" }, 401);
    const token = auth.issueLink(invitation.email, clientIp(c));
    if (!token) return c.json({ error: "Too many sign-in links asked for; try again in a few minutes" }, 429);
    try {
      await mailer.sendSignInLink(invitation.email, `${baseUrl}/sign-in?token=${token}&next=${encodeURIComponent(`/games/${invitation.gameId}`)}`);
    } catch (err) {
      console.error("Couldn't send a sign-in link", err);
      return c.json({ error: "We couldn't send the email just now; please try again in a minute" }, 503);
    }
    return c.json({ hint: emailHint(invitation.email) }, 202);
  });

  return routes;
}
