#!/usr/bin/env node
/**
 * Load test: simulates holiday parties on a running Elephant Exchange, to find where it slows down before real
 * parties do. See docs/scale-plan.md ("Load test") for how to run it against a throwaway droplet.
 *
 * Each simulated party is a demo Game with ACTORS made-up Players, started, with PHONES phone screens watching
 * it. Like real phones, each screen keeps a live connection, fetches the Feed whenever it's told the Feed changed,
 * and loads each new Photo's small copy once. Meanwhile the party's guests post (a share of them with a Photo) and
 * react, and the Host opens Gifts. One signed-in Host runs every party: a demo Game's Host may act as its made-up
 * Players (ADR 0004), so only one sign-in link is needed.
 *
 * The parties are added in stages (STAGES, e.g. 20,100,200), each held for STAGE_MINUTES; after each stage it
 * prints how long requests took, how late live updates arrived, and what failed.
 *
 *   TARGET=http://<droplet-ip>:3000 LOGS="ssh <droplet> 'cd ww/elephant-exchange-v2 && docker compose logs app --no-log-prefix'" \
 *     node scripts/load-test.mjs
 *
 * Settings (environment):
 *   TARGET          the server to test (default http://localhost:3000). Never the live site: it creates hundreds of Games.
 *   SESSION         a signed-in Host's `session` cookie value; or leave it out to sign in through the server's log:
 *   LOGS            the command printing the server's log, where sign-in links appear without Resend
 *                   (default: docker compose logs app --no-log-prefix)
 *   EMAIL           the Host to sign in as (default loadtest-host@example.com)
 *   STAGES          parties in each stage, cumulative (default 20,100,200)
 *   STAGE_MINUTES   how long each stage runs once its parties are up (default 5)
 *   PHONES          screens watching each party (default 100)
 *   ACTORS          made-up Players per party, who post and react (default 50, the demo's most)
 *   POSTS_PER_MIN   Posts per party per minute (default 4), PHOTO_SHARE of them with a Photo (default 0.25)
 *   REACTIONS_PER_MIN, MOVES_PER_MIN  per party (defaults 12 and 3)
 *   PHOTO           a real phone photo to post (default: the smoke test's, which is unrealistically small once resized)
 *
 * Simulating 20,000 phones needs a machine of its own (and `ulimit -n 65536`); run it from a second droplet in
 * the same region, not from home Wi-Fi. It talks to the server directly, not through Cloudflare, so Photos are
 * all served by the server: the worst case.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { io } from "socket.io-client";

const env = process.env;
const TARGET = (env.TARGET ?? "http://localhost:3000").replace(/\/$/, "");
const LOGS = env.LOGS ?? "docker compose logs app --no-log-prefix";
const EMAIL = env.EMAIL ?? "loadtest-host@example.com";
const STAGES = (env.STAGES ?? "20,100,200").split(",").map(Number);
const STAGE_MINUTES = Number(env.STAGE_MINUTES ?? 5);
const PHONES = Number(env.PHONES ?? 100);
const ACTORS = Math.min(50, Number(env.ACTORS ?? 50));
const POSTS_PER_MIN = Number(env.POSTS_PER_MIN ?? 4);
const PHOTO_SHARE = Number(env.PHOTO_SHARE ?? 0.25);
const REACTIONS_PER_MIN = Number(env.REACTIONS_PER_MIN ?? 12);
const MOVES_PER_MIN = Number(env.MOVES_PER_MIN ?? 3);

if (/elephantexchange\.app/.test(TARGET)) {
  console.error("Refusing to load-test the live site. Point TARGET at a throwaway server.");
  process.exit(1);
}

// The smoke test's Photo is a plain test card, so its copies are tiny: give a real phone photo (PHOTO=path) for
// realistic Photo traffic.
const photo = readFileSync(env.PHOTO ?? new URL("../e2e/fixtures/sideways-camera-photo.jpg", import.meta.url));
const REACTIONS = ["👍", "❤️", "😂", "🎉", "🔥", "😮", "⛄", "leg-lamp"];
const LINES = [
  "Who brought the singing fish?",
  "That's mine. Good luck getting into it",
  "Fair warning: I'm stealing anything with a snowman on it",
  "Whoever wrapped a box in duct tape: respect.",
  "The leg lamp has entered the building",
  "Third steal on the candle. It's frozen now!",
];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// ---- Measurements, reset each stage -------------------------------------------------------------------------

let stats = fresh();
function fresh() {
  return { timings: new Map(), delays: new Map(), errors: new Map(), counts: new Map() };
}
const note = (map, key, value) => (map.get(key) ?? map.set(key, []).get(key)).push(value);
const count = (key, n = 1) => stats.counts.set(key, (stats.counts.get(key) ?? 0) + n);
const failed = (key, why) => stats.errors.set(`${key}: ${why}`, (stats.errors.get(`${key}: ${why}`) ?? 0) + 1);

/** Sends a request, timing it under `key`; returns the response, or undefined if it failed (and notes why). */
async function call(key, path, init = {}, cookie) {
  const started = performance.now();
  try {
    const headers = new Headers(init.headers);
    if (cookie) headers.set("cookie", `session=${cookie}`);
    const res = await fetch(`${TARGET}${path}`, { ...init, headers, signal: AbortSignal.timeout(30_000) });
    note(stats.timings, key, performance.now() - started);
    if (!res.ok) failed(key, res.status);
    return res;
  } catch (e) {
    failed(key, e.name === "TimeoutError" ? "timeout (30 s)" : e.cause?.code ?? e.message);
    return undefined;
  }
}
const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function percentiles(values) {
  if (values.length === 0) return "-";
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
  return `n=${String(sorted.length).padStart(6)}  p50 ${String(at(50)).padStart(5)}  p95 ${String(at(95)).padStart(5)}  p99 ${String(at(99)).padStart(5)}  max ${String(Math.round(sorted.at(-1))).padStart(6)} ms`;
}

function report(stage, parties, screens, seconds) {
  console.log(`\n=== Stage: ${parties} parties, ${screens} screens connected, ${Math.round(seconds)} s ===`);
  console.log("Requests (how long the server took to answer):");
  for (const [key, values] of [...stats.timings].sort()) console.log(`  ${key.padEnd(22)} ${percentiles(values)}`);
  console.log("Live updates (from the change to a phone hearing of it):");
  for (const [key, values] of [...stats.delays].sort()) console.log(`  ${key.padEnd(22)} ${percentiles(values)}`);
  console.log("Counts:");
  for (const [key, n] of [...stats.counts].sort()) console.log(`  ${key.padEnd(22)} ${n}  (${(n / seconds).toFixed(1)}/s)`);
  if (stats.errors.size) {
    console.log("Errors:");
    for (const [why, n] of [...stats.errors].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)} × ${why}`);
  } else console.log("Errors: none");
}

// ---- Signing in ---------------------------------------------------------------------------------------------

async function signIn() {
  if (env.SESSION) return env.SESSION;
  const asked = await fetch(`${TARGET}/api/auth/link`, json({ email: EMAIL }));
  if (!asked.ok) throw new Error(`asking for a sign-in link failed: ${asked.status}`);
  let token;
  for (let i = 0; i < 20 && !token; i++) {
    await sleep(500);
    const line = execSync(LOGS, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
      .split("\n")
      .filter((l) => l.includes(`Sign-in link for ${EMAIL}: `))
      .at(-1);
    token = line && new URL(line.split(": ").at(-1).trim()).searchParams.get("token");
  }
  if (!token) throw new Error(`no sign-in link for ${EMAIL} in the server's log (is RESEND_API_KEY unset there?)`);
  const verified = await fetch(`${TARGET}/api/auth/verify`, json({ token }));
  const cookie = verified.headers.get("set-cookie")?.match(/session=([^;]+)/)?.[1];
  if (!cookie) throw new Error(`signing in failed: ${verified.status}`);
  return cookie;
}

// ---- A party ------------------------------------------------------------------------------------------------

/** A demo Game with its made-up Players, started; undefined if the server turned it away (busy, say). */
async function newParty(host, n) {
  const created = await call("create game", "/api/games", json({ name: `Load test party ${n}`, settings: { activeSlots: 2, maxSteals: 3 }, rosterMode: "self", demo: true }), host);
  if (created?.status === 503) count("games turned away (busy)");
  if (created?.status !== 201) return undefined;
  const { id } = await created.json();
  const players = Array.from({ length: Math.max(ACTORS, 2) }, (_, i) => `p${i}`);
  for (const playerId of players) await call("command", `/api/games/${id}/commands`, json({ type: "AddPlayer", playerId, name: `Guest ${playerId}` }), host);
  await call("command", `/api/games/${id}/commands`, json({ type: "StartGame" }), host);
  // changedAt / movedAt: when the latest Feed change or move was sent, so each phone can time hearing of it.
  return { id, players, screens: [], latest: undefined, changedAt: undefined, movedAt: undefined, timers: [], gifts: 0 };
}

/** One phone watching: a live connection, and the Feed (and each new Photo, once) fetched whenever it changes. */
function watch(party) {
  const socket = io(TARGET, { auth: { gameId: party.id }, transports: ["websocket"], reconnection: true });
  const seenPhotos = new Set();
  let fetching = false;
  let again = false;
  async function fetchFeed() {
    // Like the app: one fetch at a time; a signal meanwhile means one more afterwards.
    if (fetching) return void (again = true);
    fetching = true;
    do {
      again = false;
      const res = await call("GET feed", `/api/games/${party.id}/posts`);
      const posts = res?.ok ? await res.json().catch(() => []) : [];
      if (res?.ok) count("feed fetches");
      for (const p of posts) {
        if (!p.photo || seenPhotos.has(p.id)) continue;
        seenPhotos.add(p.id);
        const img = await call("GET photo (small)", p.photo.smallUrl ?? p.photo.url);
        if (img?.ok) count("photo bytes", (await img.arrayBuffer()).byteLength);
      }
    } while (again);
    fetching = false;
  }
  let timed; // the change this phone last timed: each is timed once, by the first signal heard after it
  socket.on("posts", () => {
    if (party.changedAt !== undefined && party.changedAt !== timed) {
      timed = party.changedAt;
      note(stats.delays, "feed signal", performance.now() - party.changedAt);
    }
    void fetchFeed();
  });
  socket.on("game", (game) => {
    party.latest = game;
    if (party.movedAt !== undefined) note(stats.delays, "game update", performance.now() - party.movedAt);
  });
  socket.on("connect_error", (e) => failed("socket connect", e.message));
  socket.on("disconnect", (why) => why !== "io client disconnect" && failed("socket", `disconnected (${why})`));
  party.screens.push(socket);
}

/** Runs `fn` about `perMinute` times a minute, at random moments, until the party is stopped. */
function every(party, perMinute, fn) {
  if (perMinute <= 0) return;
  const next = () => {
    const t = setTimeout(async () => {
      await fn();
      next();
    }, (-Math.log(1 - Math.random()) * 60_000) / perMinute); // Poisson arrivals, like a real room
    party.timers.push(t);
  };
  next();
}

/** Notes when a change was sent, for timing how late phones hear of it; forgotten after 5 s (anything later is another change's). */
function changed(party, which, at) {
  party[which] = at;
  setTimeout(() => party[which] === at && (party[which] = undefined), 5_000);
}

function liven(host, party) {
  const as = (playerId) => ({ "x-demo-player": playerId });
  every(party, POSTS_PER_MIN, async () => {
    const playerId = pick(party.players);
    let res;
    // Noted before sending: the server signals phones before its answer gets back here.
    changed(party, "changedAt", performance.now());
    if (Math.random() < PHOTO_SHARE) {
      const form = new FormData();
      form.append("text", pick(LINES));
      form.append("name", `Guest ${playerId}`);
      form.append("photo", new Blob([photo], { type: "image/jpeg" }), "photo.jpg");
      res = await call("POST photo", `/api/games/${party.id}/posts`, { method: "POST", body: form, headers: as(playerId) }, host);
    } else {
      res = await call("POST post", `/api/games/${party.id}/posts`, { ...json({ text: pick(LINES), name: `Guest ${playerId}` }), headers: { "content-type": "application/json", ...as(playerId) } }, host);
    }
    if (res?.ok) count("posts");
  });
  every(party, REACTIONS_PER_MIN, async () => {
    const feed = await call("GET feed (actor)", `/api/games/${party.id}/posts`);
    const posts = feed?.ok ? await feed.json().catch(() => []) : [];
    if (posts.length === 0) return;
    changed(party, "changedAt", performance.now());
    const res = await call("POST reaction", `/api/games/${party.id}/posts/${pick(posts).id}/reactions`, { ...json({ emoji: pick(REACTIONS), on: true }), headers: { "content-type": "application/json", ...as(pick(party.players)) } }, host);
    if (res?.ok) count("reactions");
  });
  every(party, MOVES_PER_MIN, async () => {
    const playerId = party.latest?.active?.[0];
    if (!playerId || party.latest.phase !== "playing") return;
    changed(party, "movedAt", performance.now());
    const res = await call("command", `/api/games/${party.id}/commands`, json({ type: "OpenGift", playerId, giftId: `g${++party.gifts}`, name: `Gift ${party.gifts}` }), host);
    if (res?.ok) count("moves");
  });
}

// ---- The stages ---------------------------------------------------------------------------------------------

async function health() {
  const res = await call("GET health", "/api/health");
  return res?.ok ? res.json() : { ok: false };
}

async function main() {
  console.log(`Load test against ${TARGET}: stages ${STAGES.join(", ")} parties, ${PHONES} phones each, ${STAGE_MINUTES} min a stage`);
  console.log(`Per party a minute: ${POSTS_PER_MIN} posts (${Math.round(PHOTO_SHARE * 100)}% with a Photo), ${REACTIONS_PER_MIN} reactions, ${MOVES_PER_MIN} moves`);
  const host = await signIn();
  const parties = [];
  const stop = () => {
    for (const p of parties) {
      p.timers.forEach(clearTimeout);
      p.screens.forEach((s) => s.close());
    }
  };
  process.on("SIGINT", () => {
    console.log("\nStopped.");
    stop();
    process.exit(0);
  });

  for (const target of STAGES) {
    console.log(`\nAdding parties up to ${target}…`);
    while (parties.length < target) {
      const party = await newParty(host, parties.length + 1);
      if (!party) {
        console.log(`  The server turned party ${parties.length + 1} away; holding at ${parties.length}.`);
        break;
      }
      parties.push(party);
      // Phones arrive over a few seconds, not all in one instant.
      for (let i = 0; i < PHONES; i++) {
        watch(party);
        if (i % 20 === 19) await sleep(50);
      }
      liven(host, party);
    }
    const screens = parties.reduce((n, p) => n + p.screens.length, 0);
    console.log(`  ${parties.length} parties, ${screens} screens. Settling for 20 s, then measuring for ${STAGE_MINUTES} min.`);
    await sleep(20_000);
    stats = fresh();
    const started = performance.now();
    const end = started + STAGE_MINUTES * 60_000;
    while (performance.now() < end) {
      await sleep(Math.min(30_000, end - performance.now()));
      const h = await health();
      if (h.busy) count("health said busy");
      process.stdout.write(`  ${Math.round((performance.now() - started) / 1000)} s: health ${h.ok ? "ok" : "DOWN"}${h.busy ? ", busy" : ""}\n`);
    }
    report(target, parties.length, screens, (performance.now() - started) / 1000);
  }
  stop();
  console.log(`\nDone. ${parties.length} demo Games were created; a throwaway server can simply be deleted.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
