import { Hono, type Context } from "hono";
import type { z } from "zod";
import type { Access } from "./access.js";
import { isRefusal, type Feed, type Refusal } from "./feed.js";
import type { LoadedGame } from "./game-store.js";
import { parseBody, photoSizeLimit } from "./http.js";
import { preparePhoto, smallPhoto, type photoStore, type PhotoSize } from "./photos.js";
import { muteBody, pitchBody, postBody, postGiftBody, postStatusBody, reactionBody, repitchBody } from "./schemas.js";
import { zip } from "./zip.js";

/** The HTTP answer for each way the Feed says no. */
function refused(c: Context, r: Refusal) {
  switch (r.refused) {
    case "Paused":
    case "Muted":
    case "GameOver":
      return c.json({ code: r.refused, message: r.message }, 409);
    case "TooSoon":
      return c.json({ code: r.refused, message: r.message, wait: r.wait }, 429);
    case "Invalid":
      return c.json({ error: r.message }, 400);
    case "NotFound":
      return c.json({ error: r.message }, 404);
    case "NotYours":
    case "NotHolder":
      return c.json({ error: r.message }, 403);
    case "Fixed":
      return c.json({ error: r.message }, 409);
  }
}

/** A name made safe for a file name: letters, digits and single dashes. */
const fileSafe = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/**
 * The Feed's routes: its Posts, Pitches, Reactions and Photos, and their moderation. Each checks who's asking
 * (Game access), reads the request and turns the Feed's answer into HTTP; the rules are the Feed's.
 */
export function feedRoutes(deps: {
  access: Access<LoadedGame>;
  feed: Feed;
  photos: ReturnType<typeof photoStore>;
  now: () => Date;
  /** The name someone's Post goes up under (People's rules), and making a new name theirs once it's going ahead. */
  nameToPostAs: (id: string, email: string, asked: string | undefined) => { author: string; settle: () => void } | undefined;
  noteFeature: (gameId: string, feature: string) => void;
  /** People's Muted flag. */
  setMuted: (gameId: string, email: string, muted: boolean) => void;
}) {
  const { access, feed, photos, now, nameToPostAs, noteFeature, setMuted } = deps;
  const routes = new Hono();

  // The Feed, as this viewer may see it: every visible Post, plus their own and, for a Host, all the others.
  routes.get("/api/games/:id/posts", access.need("anyone"), (c) => {
    const { id, email, role } = c.var.access;
    return c.json(feed.list(id, { email, staff: role !== undefined }));
  });


  routes.post("/api/games/:id/posts", access.need("signedIn", "Sign in to post"), photoSizeLimit, async (c) => {
    const { id, role } = c.var.access;
    const email = c.var.access.email!;
    let upload: File | undefined;
    let body: Awaited<ReturnType<typeof parseBody<z.infer<typeof postBody>>>>;
    if (c.req.header("content-type")?.startsWith("multipart/form-data")) {
      const form = await c.req.parseBody();
      const field = (k: string) => (typeof form[k] === "string" && form[k] !== "" ? form[k] : undefined);
      const file = form["photo"];
      // A file rather than a text field (checked by type, not `instanceof File`, which depends on whose File).
      upload = file !== undefined && typeof file !== "string" ? (file as File) : undefined;
      const parsed = postBody.safeParse({ text: field("text"), name: field("name"), giftId: field("giftId"), replyTo: field("replyTo") });
      body = parsed.success ? { ok: true, data: parsed.data } : { ok: false, res: c.json({ error: "Invalid request", issues: parsed.error.issues }, 400) };
    } else {
      body = await parseBody(c, postBody);
    }
    if (!body.ok) return body.res;
    if (!body.data.text && !upload) return c.json({ error: "Write something or add a Photo" }, 400);
    const viewer = { email, staff: role !== undefined };
    const { text, giftId, replyTo } = body.data;
    const no = feed.mayPost(id, viewer, { giftId, replyTo });
    if (no) return refused(c, no);
    const name = nameToPostAs(id, email, body.data.name);
    if (!name) return c.json({ error: "Say what name to post as" }, 400);

    const photo = upload && (await preparePhoto(new Uint8Array(await upload.arrayBuffer())));
    if (upload && !photo) return c.json({ error: "That doesn't look like a photo we can use" }, 400);

    name.settle();
    const ready = photo && { ...photo, small: await smallPhoto(photo.data) };
    const put = feed.post(id, viewer, { author: name.author, text, giftId, replyTo, photo: ready });
    return isRefusal(put) ? refused(c, put) : c.body(null, 201);
  });

  /**
   * A Gift's Pitch: the story its holder tells, to tempt a Steal or to fend one off. Each holder writes their own
   * part, kept when the Gift is stolen, so the story builds through the night. The holder may write theirs while
   * they hold the Gift and change or remove it later; the Host and Co-hosts may write any holder's part (for a
   * guest without a phone) and change any part. It's a Post, so the Feed's rules apply: Approval, Paused, Mute, Hide.
   */


  /**
   * A Gift's Pitch: the story its holder tells, to tempt a Steal or to fend one off. Each holder writes their own
   * part, kept when the Gift is stolen, so the story builds through the night: a bold headline (the tagline), the
   * story, and a Photo, any of them. The holder may write theirs while they hold the Gift and change or remove it
   * later; the Host and Co-hosts may write any holder's part (for a guest without a phone) and change any part.
   * It's a Post, so the Feed's rules apply: Approval, Paused, Mute, Hide. Words come as JSON; with a Photo, as a
   * multipart form, its file in `photo`. Nothing left (no tagline, words or Photo) removes the part.
   */
  routes.put("/api/games/:id/gifts/:giftId/pitch", access.need("signedIn"), photoSizeLimit, async (c) => {
    const { id, role } = c.var.access;
    const email = c.var.access.email!;
    const giftId = c.req.param("giftId");
    let upload: File | undefined;
    let body: Awaited<ReturnType<typeof parseBody<z.infer<typeof pitchBody>>>>;
    if (c.req.header("content-type")?.startsWith("multipart/form-data")) {
      const form = await c.req.parseBody();
      const field = (k: string) => (typeof form[k] === "string" && form[k] !== "" ? form[k] : undefined);
      const file = form["photo"];
      upload = file !== undefined && typeof file !== "string" ? (file as File) : undefined;
      const parsed = pitchBody.safeParse({ tagline: field("tagline"), text: field("text"), playerId: field("playerId") });
      body = parsed.success ? { ok: true, data: parsed.data } : { ok: false, res: c.json({ error: "Invalid request", issues: parsed.error.issues }, 400) };
    } else {
      body = await parseBody(c, pitchBody);
    }
    if (!body.ok) return body.res;
    const viewer = { email, staff: role !== undefined, playerId: c.var.access.playerId };
    const no = feed.mayPitch(id, viewer, giftId, body.data.playerId);
    if (no) return refused(c, no);

    const photo = upload && (await preparePhoto(new Uint8Array(await upload.arrayBuffer())));
    if (upload && !photo) return c.json({ error: "That doesn't look like a photo we can use" }, 400);
    const { tagline, text, removePhoto, playerId } = body.data;
    const ready = photo && { ...photo, small: await smallPhoto(photo.data) };
    const written = feed.writePitch(id, viewer, giftId, { playerId, tagline, text, removePhoto, photo: ready });
    if (isRefusal(written)) return refused(c, written);
    if (written.created) noteFeature(id, "pitch");
    return c.body(null, 204);
  });

  /**
   * "Pitch it again": the Gift's holder sends their part back to the top of the Feed, for everyone to see again. Not
   * more often than the Game allows (5 minutes unless the Host changed it), so nobody bombards the Feed; the Host
   * and Co-hosts may do it any time, for any holder.
   */
  routes.post("/api/games/:id/gifts/:giftId/pitch/again", access.need("signedIn"), async (c) => {
    const { id } = c.var.access;
    const email = c.var.access.email!;
    const giftId = c.req.param("giftId");
    const body = await parseBody(c, repitchBody);
    if (!body.ok) return body.res;
    const viewer = { email, staff: c.var.access.role !== undefined, playerId: c.var.access.playerId };
    const no = feed.pitchAgain(id, viewer, giftId, body.data.playerId);
    return no ? refused(c, no) : c.body(null, 204);
  });

  // Every visible Photo in one zip, for the Host to keep before they're deleted (hidden ones stay out).
  routes.get("/api/games/:id/album.zip", access.need("staff", "Only the Host and Co-hosts can download the album"), (c) => {
    const { id, game } = c.var.access;

    const rows = feed.album(id);
    const digits = Math.max(2, String(rows.length).length);
    const files: { name: string; data: Uint8Array }[] = [];
    const captions: string[] = [];
    rows.forEach((p, i) => {
      const data = photos.read(p.gameId, p.id);
      if (!data) return;
      const name = `${String(i + 1).padStart(digits, "0")}-${fileSafe(p.author) || "photo"}.jpg`;
      files.push({ name, data });
      captions.push(`${name}  ${p.author}${p.text ? `: ${p.text.replace(/\s+/g, " ")}` : ""}`);
    });
    files.push({ name: "captions.txt", data: Buffer.from(captions.join("\n") + "\n", "utf8") });

    return c.body(new Uint8Array(zip(files, now())), 200, {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${fileSafe(game.name) || "game"}-photos.zip"`,
      "cache-control": "no-store",
    });
  });

  /**
   * A Post's Photo, full size or its small copy, to whoever may see the Post: anyone if it's visible, otherwise only
   * its poster and the Hosts. The address ends in .jpg so Cloudflare keeps a visible one for a few minutes and the
   * phones at a party mostly get it from there; one not everyone may see is never kept by a shared cache. (A Post
   * hidden after its Photo was fetched can still be loaded from that cache, by its address, for those minutes.)
   */
  async function servePhoto(c: Context, size: PhotoSize) {
    const { id = "", postId = "" } = c.req.param();
    const email = access.emailOf(c);
    const row = feed.photoFor(id, { email, staff: email !== undefined && access.roleIn(id, email) !== undefined }, postId);
    if (!row) return c.json({ error: "No such Photo" }, 404);
    const visible = row.status === "visible";
    let data = photos.read(row.gameId, row.id, size);
    if (!data && size === "small") {
      // A Photo kept before small copies were made: make its copy now, once.
      const full = photos.read(row.gameId, row.id);
      const small = full && (await smallPhoto(full));
      if (small) photos.save(row.gameId, row.id, full, small);
      data = small ?? full;
    }
    if (!data) return c.json({ error: "No such Photo" }, 404);
    return c.body(new Uint8Array(data), 200, {
      "content-type": "image/jpeg",
      "cache-control": visible ? "public, max-age=600" : "private, max-age=86400",
    });
  }
  routes.get("/api/games/:id/posts/:postId/photo.jpg", (c) => servePhoto(c, "full"));
  routes.get("/api/games/:id/posts/:postId/photo-small.jpg", (c) => servePhoto(c, "small"));
  // Its old address, on pages loaded before the change.
  routes.get("/api/games/:id/posts/:postId/photo", (c) => servePhoto(c, "full"));

  // Anyone signed in can put a Reaction on a visible Post or take it back, even while posting is Paused.
  routes.post("/api/games/:id/posts/:postId/reactions", access.need("signedIn", "Sign in to react"), async (c) => {
    const { id } = c.var.access;
    const email = c.var.access.email!;
    const postId = c.req.param("postId");
    const body = await parseBody(c, reactionBody);
    if (!body.ok) return body.res;
    const no = feed.react(id, email, postId, body.data.emoji, body.data.on);
    return no ? refused(c, no) : c.body(null, 204);
  });

  // Approving a Pending Post and showing a Hidden one again are the same: it becomes visible.
  routes.post("/api/games/:id/posts/:postId/status", access.need("staff", "Only the Host and Co-hosts can moderate this Game"), async (c) => {
    const { id } = c.var.access;
    const postId = c.req.param("postId");
    const body = await parseBody(c, postStatusBody);
    if (!body.ok) return body.res;
    const no = feed.setStatus(id, postId, body.data.status, body.data.thread);
    return no ? refused(c, no) : c.body(null, 204);
  });

  /**
   * Attaches a Post to a Gift after it was posted (a great photo whose poster didn't pick the Gift), or takes it off.
   * For its poster, and the Host and Co-hosts.
   */
  routes.post("/api/games/:id/posts/:postId/gift", access.need("signedIn"), async (c) => {
    const { id, role } = c.var.access;
    const email = c.var.access.email!;
    const postId = c.req.param("postId");
    const body = await parseBody(c, postGiftBody);
    if (!body.ok) return body.res;
    const no = feed.moveToGift(id, { email, staff: role !== undefined }, postId, body.data.giftId);
    return no ? refused(c, no) : c.body(null, 204);
  });

  /** The Host or a Co-host mutes whoever wrote a Post (they can't post or reply), or unmutes them. */
  routes.post("/api/games/:id/mute", access.need("staff", "Only the Host and Co-hosts can moderate this Game"), async (c) => {
    const { id } = c.var.access;
    const body = await parseBody(c, muteBody);
    if (!body.ok) return body.res;
    const { postId, muted, hidePosts } = body.data;
    const no = feed.mute(id, postId, muted, hidePosts ?? false, (email, on) => setMuted(id, email, on));
    return no ? refused(c, no) : c.body(null, 204);
  });

  return routes;
}
