import { and, asc, count, desc, eq, inArray, like, sql } from "drizzle-orm";
import { Hono } from "hono";
import { phase, roster } from "@elephant/rules";
import { gameHosts, games, organizations, sessions, signInLinks, users, type Db } from "./db.js";
import type { createFeedback } from "./feedback.js";
import type { GameStore, LoadedGame } from "./game-store.js";
import { parseBody } from "./http.js";
import type { themeStore } from "./photos.js";
import { excludeBody, publishBody } from "./schemas.js";
import { isVisitor, type createStats } from "./stats.js";
import { healthWarnings, type ServerHealth } from "./system.js";
import type * as Wire from "./wire.js";

/**
 * The admin pages' routes: People, Games, Stats, System, Feedback, deleting a Game and clearing out test data. Only
 * for ADMIN_EMAILS: the server checks that before any of these is reached.
 */
export function adminRoutes(deps: {
  db: Db;
  now: () => Date;
  /** The Game as it stands now (it must exist). */
  load: (id: string) => LoadedGame;
  stats: ReturnType<typeof createStats>;
  said: ReturnType<typeof createFeedback>;
  /** This server's health, as the System page shows it. */
  health: () => ServerHealth;
  /** The day's cap on sign-in emails, and the bytes the Photos take, for the Stats page. */
  signInEmailCap: number;
  photoBytes: () => number;
  /** Removes a Game and everything kept for it (games.ts). */
  deleteGame: (id: string) => void;
  store: Pick<GameStore, "clear">;
  themeImages: ReturnType<typeof themeStore>;
}) {
  const { db, now, load, stats, said, health, signInEmailCap, photoBytes, deleteGame, store, themeImages } = deps;
  const routes = new Hono();

  /** Everyone who has signed in, newest first: when, whether a feedback email is OK, and what they've made. */
  routes.get("/api/admin/people", (c) => {
    const hosted = db
      .select({ email: gameHosts.email, demo: games.demo, n: count() })
      .from(gameHosts)
      .innerJoin(games, eq(games.id, gameHosts.gameId))
      .where(eq(gameHosts.role, "host"))
      .groupBy(gameHosts.email, games.demo)
      .all();
    const orgs = db.select({ email: organizations.organizerEmail, name: organizations.name }).from(organizations).orderBy(asc(organizations.createdAt)).all();
    // Demo visitors aren't people who signed in: they're counted on the Stats page instead.
    const people = db.select().from(users).orderBy(desc(users.createdAt)).all().filter((u) => !isVisitor(u.email));
    return c.json(
      people.map((u) => ({
        email: u.email,
        firstSeen: u.createdAt.toISOString(),
        lastSignIn: u.lastSignInAt?.toISOString() ?? null,
        feedbackOk: u.feedbackOk,
        tipNoteRead: u.tipNoteRead,
        games: hosted.find((h) => h.email === u.email && !h.demo)?.n ?? 0,
        demoGames: hosted.find((h) => h.email === u.email && h.demo)?.n ?? 0,
        organizations: orgs.filter((o) => o.email === u.email).map((o) => o.name),
      }) satisfies Wire.AdminPerson),
    );
  });

  /** Every Game, newest first, with its Host and how far along it is. */
  routes.get("/api/admin/games", (c) => {
    const rows = db
      .select({ id: games.id, demo: games.demo, createdAt: games.createdAt, host: gameHosts.email })
      .from(games)
      .leftJoin(gameHosts, and(eq(gameHosts.gameId, games.id), eq(gameHosts.role, "host")))
      .orderBy(desc(games.createdAt), desc(sql`${games}.rowid`))
      .all();
    return c.json(
      rows.map((r) => {
        const game = load(r.id)!;
        return {
          id: r.id,
          name: game.name,
          demo: r.demo,
          host: r.host ?? "",
          phase: phase(game.state),
          players: roster(game.state).length,
          createdAt: r.createdAt.toISOString(),
        } satisfies Wire.AdminGame;
      }),
    );
  });

  /** The usage statistics (ADR-0005), brought up to date first. */
  routes.get("/api/admin/stats", (c) => {
    stats.refresh();
    return c.json(stats.summary({ signInEmailCap, photoBytes: photoBytes(), ratings: said.hostRatings() }));
  });


  /**
   * The System page: every server's health, with what's wrong in words. Just this server for now; with more, this
   * is where the first would ask each of the others for theirs (docs/scale-plan.md, "Watching the servers").
   */
  routes.get("/api/admin/system", (c) => {
    c.header("Cache-Control", "no-store");
    const at = now();
    const servers = [health()].map((s) => ({ ...s, warnings: healthWarnings(s, at) }));
    return c.json({ checkedAt: at.toISOString(), servers });
  });

  /** What Hosts and guests said, newest first, with the averages. */
  routes.get("/api/admin/feedback", (c) => c.json(said.summary()));

  /** Puts a testimonial on the front page, or takes it down: only one its writer said may be quoted. */
  routes.post("/api/admin/feedback/:id/published", async (c) => {
    const body = await parseBody(c, publishBody);
    if (!body.ok) return body.res;
    if (!said.setPublished(c.req.param("id"), body.data.published)) return c.json({ error: "Not something that may be quoted" }, 409);
    return c.body(null, 204);
  });

  /** Leaves a Game out of the statistics (Jim's trial runs), or puts it back. */
  routes.post("/api/admin/stats/games/:id", async (c) => {
    const body = await parseBody(c, excludeBody);
    if (!body.ok) return body.res;
    if (!stats.setExcluded(c.req.param("id"), body.data.excluded)) return c.json({ error: "No such Game" }, 404);
    return c.body(null, 204);
  });


  routes.delete("/api/admin/games/:id", (c) => {
    const id = c.req.param("id");
    if (!db.select({ id: games.id }).from(games).where(eq(games.id, id)).get()) return c.json({ error: "No such Game" }, 404);
    deleteGame(id);
    return c.body(null, 204);
  });

  /**
   * Clears out what the smoke test leaves behind: everyone with an @example.com address (a domain nobody can
   * really have), the Games they host and the Organizations they run. Games of anyone else are kept.
   */
  routes.post("/api/admin/test-data/delete", (c) => {
    const testers = like(sql`lower(${users.email})`, "%@example.com");
    const people = db.select({ id: users.id, email: users.email }).from(users).where(testers).all();
    const emails = people.map((p) => p.email);
    const testGames = emails.length
      ? db.selectDistinct({ id: gameHosts.gameId }).from(gameHosts).where(and(eq(gameHosts.role, "host"), inArray(gameHosts.email, emails))).all()
      : [];
    for (const { id } of testGames) deleteGame(id);
    const testOrgs = emails.length ? db.select({ id: organizations.id }).from(organizations).where(inArray(organizations.organizerEmail, emails)).all() : [];
    for (const { id } of testOrgs) stats.orgDeleted(id);
    db.transaction((tx) => {
      for (const { id } of testOrgs) {
        tx.update(games).set({ orgId: null }).where(eq(games.orgId, id)).run();
        tx.delete(organizations).where(eq(organizations.id, id)).run();
      }
      if (people.length) {
        tx.delete(sessions).where(inArray(sessions.userId, people.map((p) => p.id))).run();
        tx.delete(signInLinks).where(inArray(signInLinks.email, emails)).run();
        tx.delete(users).where(inArray(users.id, people.map((p) => p.id))).run();
      }
    });
    for (const { id } of testOrgs) for (const kind of ["logo", "background"] as const) themeImages.remove(`org-${id}`, kind);
    // Games that showed a removed Organization's Theme are rebuilt without it.
    store.clear();
    return c.json({ people: people.length, games: testGames.length, organizations: testOrgs.length });
  });

  return routes;
}
