import { roster } from "@elephant/rules";
import { Hono } from "hono";
import type { Access } from "./access.js";
import type { Feed } from "./feed.js";
import type { LoadedGame } from "./game-store.js";
import { parseBody } from "./http.js";
import type { People } from "./people.js";
import { approveNameBody, askAnswerBody, cohostBody, guestBody, joinBody, personBody, playerEmailBody, renameBody } from "./schemas.js";
import type * as Wire from "./wire.js";

/**
 * The routes about People in a Game: the Host's Co-hosts panel, Names (waiting, approved, changed), Co-hosts and
 * self sign-up. Each checks who's asking (Game access), reads the request and turns People's answer into HTTP;
 * the rules are People's.
 */
export function peopleRoutes<Result extends object>(deps: {
  access: Access<LoadedGame>;
  /** People, whose self sign-up answers with the Game as now shown (or the rule that refused it). */
  people: People<LoadedGame, Result>;
  feed: Feed;
  /** The Game as it stands now (it must exist). */
  load: (id: string) => LoadedGame;
  /** Tells the Staff's screens that who co-hosts (or plays as whom) changed. */
  staffChanged: (id: string) => void;
}) {
  const { access, people, feed, load, staffChanged } = deps;
  const routes = new Hono();

  /** Everyone the Game knows, for the Host's Co-hosts panel: by name where there is one, never by email. */
  routes.get("/api/games/:id/people", access.need("host", "Only the Host can appoint Co-hosts"), (c) => {
    const { id, game } = c.var.access;
    return c.json({ people: people.panel(id, game, c.var.access.email!) });
  });

  /** The Host switches someone's Co-host role on or off, or says which Player a Host or Co-host plays as. */
  routes.post("/api/games/:id/people/:key", access.need("host", "Only the Host can appoint Co-hosts"), async (c) => {
    const { id } = c.var.access;
    const key = c.req.param("key");
    const body = await parseBody(c, personBody);
    if (!body.ok) return body.res;
    const no = people.appoint(id, key, body.data);
    return no ? c.json({ error: no.message }, no.refused === "NotFound" ? 404 : 400) : c.body(null, 204);
  });

  /** Which Players are the Host or a Co-host, for their consoles to mark: they may need to step in on those turns. */
  /** Under Approve names: the names people asked for, waiting for the Host or a Co-host, with what's shown meanwhile. */
  routes.get("/api/games/:id/names/pending", access.need("staff", "Only the Host and Co-hosts approve names"), (c) => {
    const { id, game } = c.var.access;
    return c.json({ pending: people.pending(id, game) });
  });

  routes.post("/api/games/:id/names/approve", access.need("staff", "Only the Host and Co-hosts approve names"), async (c) => {
    const { id } = c.var.access;
    const body = await parseBody(c, approveNameBody);
    if (!body.ok) return body.res;
    const no = people.approve(id, body.data.key);
    return no ? c.json({ error: no.message }, 404) : c.body(null, 204);
  });

  /** Someone changes their own name in a Game (a Player's or a Guest's), unless the Host or a Co-host locked it. */
  routes.post("/api/games/:id/me/name", access.need("signedIn"), async (c) => {
    const { id } = c.var.access;
    const email = c.var.access.email!;
    const body = await parseBody(c, joinBody);
    if (!body.ok) return body.res;
    const changed = people.changeMyName(id, email, body.data.name);
    if (changed === "locked") return c.json({ code: "NameLocked", message: "Your Host set this name" }, 409);
    return c.body(null, changed === "held" ? 202 : 204); // 202: accepted, waiting for approval
  });

  /** The Host or a Co-host renames someone, found by their Player or one of their Posts, and locks the name or not. */
  routes.post("/api/games/:id/names", access.need("staff", "Only the Host and Co-hosts can rename people"), async (c) => {
    const { id } = c.var.access;
    const body = await parseBody(c, renameBody);
    if (!body.ok) return body.res;
    const game = load(id); // the latest copy, read after the body: see GameAccess.game
    const { playerId, postId, key, name, locked } = body.data;
    if (key !== undefined) {
      const no = people.renameByKey(id, key, name, locked);
      if (no) return c.json({ error: no.message }, 404);
    } else if (playerId !== undefined) {
      if (!roster(game.state).some((p) => p.id === playerId)) return c.json({ error: "No such Player in this Game" }, 404);
      people.rename(id, { playerId }, name, locked);
    } else {
      const by = feed.posterOf(id, postId!);
      if (!by) return c.json({ error: "No such Post in this Game" }, 404);
      people.rename(id, { email: by }, name, locked);
    }
    return c.body(null, 204);
  });

  // The guest list: Players with emails, so whoever signs in with one is that Player (ADR 0007). Emails are seen
  // only by the Staff.
  routes.get("/api/games/:id/guest-list", access.need("staff", "Only the Host and Co-hosts"), (c) => {
    const { id, game } = c.var.access;
    return c.json({ players: people.guestList(id, game) satisfies Wire.GuestListEntry[] });
  });

  routes.post("/api/games/:id/guest-list", access.need("staff", "Only the Host and Co-hosts can add Players"), async (c) => {
    const { id } = c.var.access;
    const body = await parseBody(c, guestBody);
    if (!body.ok) return body.res;
    const added = people.addWithEmail(id, body.data.name, body.data.email);
    if ("refused" in added) return c.json({ code: added.refused, message: added.message }, 409);
    staffChanged(id);
    return "code" in added.result ? c.json(added.result, 409) : c.json({ ...added.result, playerId: added.playerId });
  });

  routes.put("/api/games/:id/players/:playerId/email", access.need("staff", "Only the Host and Co-hosts can change the guest list"), async (c) => {
    const { id } = c.var.access;
    const body = await parseBody(c, playerEmailBody);
    if (!body.ok) return body.res;
    const no = people.setPlayerEmail(id, c.req.param("playerId"), body.data.email);
    if (no) return c.json({ code: no.refused, message: no.message }, no.refused === "NotFound" ? 404 : 409);
    staffChanged(id);
    return c.body(null, 204);
  });

  // In a Host-entered Game, a Guest who brought a gift asks to be added as a Player; the Staff add them with a tap.
  routes.post("/api/games/:id/ask-to-play", access.need("signedIn"), async (c) => {
    const { id, game } = c.var.access;
    const email = c.var.access.email!;
    const body = await parseBody(c, joinBody);
    if (!body.ok) return body.res;
    if (game.rosterMode === "self") return c.json({ error: "Join as a Player yourself in this Game" }, 409);
    const no = people.askToPlay(id, email, body.data.name);
    if (no) return c.json({ code: no.refused, message: no.message }, 409);
    staffChanged(id);
    return c.body(null, 204);
  });

  routes.delete("/api/games/:id/ask-to-play", access.need("signedIn"), (c) => {
    const { id } = c.var.access;
    people.stopAsking(id, c.var.access.email!);
    staffChanged(id);
    return c.body(null, 204);
  });

  routes.get("/api/games/:id/asking", access.need("staff", "Only the Host and Co-hosts"), (c) => {
    const { id, game } = c.var.access;
    return c.json({ asking: people.askingToPlay(id, game) satisfies Wire.AskingToPlay[] });
  });

  routes.post("/api/games/:id/asking", access.need("staff", "Only the Host and Co-hosts can add Players"), async (c) => {
    const { id } = c.var.access;
    const body = await parseBody(c, askAnswerBody);
    if (!body.ok) return body.res;
    const answered = people.answerAsk(id, body.data.key, body.data.add);
    if ("refused" in answered) return c.json({ error: answered.message }, 404);
    staffChanged(id);
    return c.body(null, 204);
  });

  routes.get("/api/games/:id/staff", access.need("staff", "Only the Host and Co-hosts"), (c) => {
    const { id, game } = c.var.access;
    return c.json({ staff: people.staffOf(id, game).map(({ playerId, role }) => ({ playerId, role }) satisfies Wire.StaffMember) });
  });

  routes.post("/api/games/:id/cohosts", access.need("host", "Only the Host can appoint Co-hosts"), async (c) => {
    const { id } = c.var.access;
    const body = await parseBody(c, cohostBody);
    if (!body.ok) return body.res;
    const game = load(id); // the latest copy, read after the body: see GameAccess.game
    const { email: who, playsAs } = body.data;
    if (playsAs !== undefined && !roster(game.state).some((p) => p.id === playsAs)) return c.json({ error: "No such Player in this Game" }, 400);
    people.addCohost(id, who, playsAs);
    staffChanged(id);
    return c.body(null, 204);
  });

  /** Who co-hosts this Game, for the Host and the Co-hosts themselves. */
  routes.get("/api/games/:id/cohosts", access.need("staff", "Only the Host and Co-hosts"), (c) => {
    const { id } = c.var.access;
    const cohosts = [...people.staff(id)].filter(([, h]) => h.role === "cohost").map(([email]) => email);
    return c.json({ cohosts: cohosts.sort() });
  });

  /** The Host takes someone off the Game's Co-hosts. The Host can't be removed this way. */
  routes.delete("/api/games/:id/cohosts/:email", access.need("host", "Only the Host can remove Co-hosts"), (c) => {
    const { id } = c.var.access;
    const who = c.req.param("email").trim().toLowerCase();
    people.removeCohost(id, who);
    staffChanged(id);
    return c.body(null, 204);
  });

  // A person adds themselves as a Player, in a Self sign-up Game. The server picks the Player's id and
  // sends the same AddPlayer command the Host's button does, so the rules are untouched.
  routes.post("/api/games/:id/join", access.need("signedIn"), async (c) => {
    const { id } = c.var.access;
    const email = c.var.access.email!;
    const body = await parseBody(c, joinBody);
    if (!body.ok) return body.res;
    const game = load(id); // the latest copy, read after the body: see GameAccess.game
    if (game.rosterMode !== "self") return c.json({ error: "The Host adds the Players in this Game" }, 403);
    const joined = people.join(id, email, body.data.name);
    if ("refused" in joined) return c.json({ code: joined.refused, message: joined.message }, 409);
    const { result, playerId } = joined;
    return "code" in result ? c.json(result, 409) : c.json({ ...result, me: { playerId } });
  });

  return routes;
}
