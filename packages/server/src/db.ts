import { join } from "node:path";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const games = sqliteTable("games", {
  id: text("id").primaryKey(),
  /** What the Host calls it, such as "OA Holiday Party". */
  name: text("name").notNull().default("Gift exchange"),
  /** A line under the name on the big screen and the Host's banner, such as "It's going to be a gas!"; "" for none. */
  tagline: text("tagline").notNull().default(""),
  /** When and where the party is, as the Host writes it ("Fri Dec 12, 10 am · Room B"), for the welcome screen; "" for none. */
  whenWhere: text("when_where").notNull().default(""),
  /** Who adds Players: only the Host and Co-hosts ("host"), or people themselves from their phones too ("self"). */
  rosterMode: text("roster_mode", { enum: ["host", "self"] }).notNull().default("host"),
  /** The Game's rule for Posts: "open" (they appear at once), "approval" (each waits for a Host) or "paused" (no posting). */
  moderation: text("moderation", { enum: ["open", "approval", "paused"] }).notNull().default("open"),
  /** For a tough crowd: a name people pick for themselves waits for a Host or Co-host to approve it. Off by default. */
  approveNames: integer("approve_names", { mode: "boolean" }).notNull().default(false),
  /** How long each Turn's countdown runs, as a guide for the Host; 0 shows no timer. Nobody is ever skipped by it. */
  turnSeconds: integer("turn_seconds").notNull().default(60),
  /** Against flooding the Feed: the most Posts a guest may make in a minute (the Host and Co-hosts aren't limited); 0 for no limit. */
  postsPerMinute: integer("posts_per_minute").notNull().default(3),
  /** How long a holder waits before sending their Pitch to the top of the Feed again; 0 for no limit. */
  repitchMinutes: integer("repitch_minutes").notNull().default(5),
  /** The Worst Gift Vote: "none" (not opened yet), "open" or "closed" (results revealed). */
  voteStatus: text("vote_status", { enum: ["none", "open", "closed"] }).notNull().default("none"),
  /** What the big screen shows while the vote is open: "live" counts, "hidden" ones, or the "parade" of Gifts. */
  voteDisplay: text("vote_display", { enum: ["live", "hidden", "parade"] }).notNull().default("live"),
  /** The Gift that won once the vote closed (null if nobody voted). */
  voteWinner: text("vote_winner"),
  /** What the big screen shows, switched by the Host: the Gift board, the rules, the join code, or the catalog. */
  screenMode: text("screen_mode", { enum: ["gifts", "rules", "qr", "catalog", "highlights"] }).notNull().default("gifts"),
  /** The Organization whose Theme the Game shows, if the Host picked one. */
  orgId: text("org_id").references(() => organizations.id),
  /**
   * The Game's own Theme, overriding its Organization's part by part; null parts fall back to it. Colors are
   * "#rrggbb"; logo and background are a version for the stored image (it changes with each upload).
   */
  themeColor: text("theme_color"),
  themePage: text("theme_page"),
  themeLogo: text("theme_logo"),
  themeBackground: text("theme_background"),
  /** Made with "Try a demo game": made-up Players, to show the app off. */
  demo: integer("demo", { mode: "boolean" }).notNull().default(false),
  /** The GameSettings the Game was created with (JSON); later changes are SettingsChanged events. */
  settings: text("settings").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  check("games_roster_mode", sql`${t.rosterMode} IN ('host', 'self')`),
  check("games_moderation", sql`${t.moderation} IN ('open', 'approval', 'paused')`),
  check("games_vote_status", sql`${t.voteStatus} IN ('none', 'open', 'closed')`),
  check("games_vote_display", sql`${t.voteDisplay} IN ('live', 'hidden', 'parade')`),
  check("games_screen_mode", sql`${t.screenMode} IN ('gifts', 'rules', 'qr', 'catalog', 'highlights')`),
]);

/** A group whose exchanges share a Theme. Only its Organizer (who created it) can change it. */
export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  organizerEmail: text("organizer_email").notNull(),
  /** The Theme, each part optional: colors as "#rrggbb", images as a version for the stored file. */
  color: text("color"),
  page: text("page"),
  logo: text("logo"),
  background: text("background"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** The log of each Game (ADR-0001): every event, in order. The Game's state is rebuilt from it. */
export const gameEvents = sqliteTable(
  "game_events",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.id),
    seq: integer("seq").notNull(),
    event: text("event").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.seq] })],
);

/** People who have signed in at least once. */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  lastSignInAt: integer("last_sign_in_at", { mode: "timestamp_ms" }),
  /** They said it's OK to email them to ask how it went (ticked at sign-in, changed on the home screen). */
  feedbackOk: integer("feedback_ok", { mode: "boolean" }).notNull().default(false),
  /** They ticked that they've read and considered Jim's tip note, so New Game no longer shows it. */
  tipNoteRead: integer("tip_note_read", { mode: "boolean" }).notNull().default(false),
  /** Their own Game options (a whole GameOptions, JSON), saved with "Always start with these settings". */
  myOptions: text("my_options"),
  /** New Game uses `myOptions` straight away; unticking the box keeps them, to start from next time. */
  alwaysMyOptions: integer("always_my_options", { mode: "boolean" }).notNull().default(false),
});

/** Emailed sign-in links. Only a hash of each token is kept, so a leaked database can't sign anyone in. */
export const signInLinks = sqliteTable(
  "sign_in_links",
  {
    tokenHash: text("token_hash").primaryKey(),
    email: text("email").notNull(),
    /** When and from where it was asked for: the rate limits count these. */
    requestedAt: integer("requested_at", { mode: "timestamp_ms" }).notNull(),
    clientIp: text("client_ip").notNull(),
    /** The "OK to email me for feedback" box, ticked when asking; carried to the person when the link is used. */
    feedbackOk: integer("feedback_ok", { mode: "boolean" }).notNull().default(false),
    /** Where they came from (?ref=), carried to the statistics when the link is used. */
    ref: text("ref"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("sign_in_links_requested_at").on(t.requestedAt)],
);

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

/** Who runs each Game. By email, so a Co-host can be appointed before they have ever signed in. */
export const gameHosts = sqliteTable(
  "game_hosts",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.id),
    email: text("email").notNull(),
    role: text("role", { enum: ["host", "cohost"] }).notNull(),
    /**
     * The Player this Host or Co-host plays as, when the Host has said (for a Player they typed in). One who joined
     * as a Player themselves is known by game_players instead.
     */
    playerId: text("player_id"),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.email] }), check("game_hosts_role", sql`${t.role} IN ('host', 'cohost')`)],
);

/**
 * Everyone who has opened a Game while signed in, so the Host can find them by name to make them a Co-host.
 */
export const gameVisitors = sqliteTable(
  "game_visitors",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.id),
    email: text("email").notNull(),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.email] })],
);

/**
 * Each person's name in a Game, beyond a Player's (which the Game's own log keeps): a Guest's name, which they post
 * as, and whether the Host or a Co-host has locked the name they set, so its owner can't change it back.
 */
export const gameNames = sqliteTable(
  "game_names",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.id),
    email: text("email").notNull(),
    /** A Guest's name; null for a Player, whose name is on the roster. */
    name: text("name"),
    locked: integer("locked", { mode: "boolean" }).notNull().default(false),
    /** Under Approve names, the name they asked for, waiting for a Host or Co-host to approve it. */
    pending: text("pending"),
    /** Muted by the Host or a Co-host: they can't post or reply in this Game (they can still react). */
    muted: integer("muted", { mode: "boolean" }).notNull().default(false),
    /**
     * In a Host-entered Game, a Guest who brought a gift asks to be added as a Player, by this name; null when not
     * asking. The Host or a Co-host adds them with one tap, or says they're not playing.
     */
    asksToPlay: text("asks_to_play"),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.email] })],
);

/**
 * Players who signed up themselves, and which person each one is: only that person may post or vote as them.
 * One Player per person per Game. Players the Host entered have no row here.
 */
export const gamePlayers = sqliteTable(
  "game_players",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.id),
    playerId: text("player_id").notNull(),
    email: text("email").notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.playerId] }), uniqueIndex("game_players_person").on(t.gameId, t.email)],
);

/**
 * Personal invitations a Host emailed to Players on the guest list (ADR 0007). Each signs its person in once, until
 * the Game ends; only a hash of the token is kept. A newer invitation to the same person replaces an unused one.
 */
export const invitations = sqliteTable(
  "invitations",
  {
    tokenHash: text("token_hash").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id),
    email: text("email").notNull(),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("invitations_person").on(t.gameId, t.email), index("invitations_sent_at").on(t.sentAt)],
);

/**
 * When each Player who's up now was called up (or their timer last reset), for the turn timer. Kept beside the
 * log rather than in it: the timer is only a guide and changes nothing in the Game.
 */
export const turnClocks = sqliteTable(
  "turn_clocks",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.id),
    playerId: text("player_id").notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.playerId] })],
);

/**
 * What people share during a Game. `email` says whose it is (they can always see their own) and is never shown;
 * `author` is the name everyone sees. A Pending or Hidden Post is seen only by its poster and the Hosts.
 */
export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id),
    email: text("email").notNull(),
    author: text("author").notNull(),
    /** The Gift it's about, if the poster said; it then shows under that Gift as well as in the Feed. */
    giftId: text("gift_id"),
    /** The Post this one replies to, if it's a reply; it's shown quoted above it. */
    replyTo: text("reply_to"),
    /** Empty when the Post is just a Photo. */
    text: text("text").notNull(),
    /** A Post's Photo is stored as a file (see photos.ts); these are its size, and null when there's none. */
    photoWidth: integer("photo_width"),
    photoHeight: integer("photo_height"),
    status: text("status", { enum: ["visible", "pending", "hidden"] }).notNull(),
    /**
     * Why a Hidden Post went with another action, so undoing that brings back only what it hid: the id of the Post
     * whose thread was hidden, or "mute" when its poster was muted with their Posts hidden. Null when hidden by itself.
     */
    hiddenWith: text("hidden_with"),
    /**
     * Set when the Post is a part of its Gift's Pitch: the Player whose part it is (the Gift's holder when it was
     * written). One part per Player per Gift; the parts build up as the Gift is stolen.
     */
    pitchFor: text("pitch_for"),
    /** A Pitch part's eye-catching headline, shown bold above its words. */
    tagline: text("tagline"),
    /** When a Pitch part was last sent to the top of the Feed again; the Feed orders by this, else `createdAt`. */
    bumpedAt: integer("bumped_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("posts_game").on(t.gameId, t.createdAt),
    uniqueIndex("posts_pitch_once").on(t.gameId, t.giftId, t.pitchFor),
    check("posts_status", sql`${t.status} IN ('visible', 'pending', 'hidden')`)],
);

/**
 * Each person's Reactions to Posts: one row per Reaction they've put on a Post (they may put on several), taken
 * back by deleting it. Kept with the Game's id so they go when the Game does.
 */
export const postReactions = sqliteTable(
  "post_reactions",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.id),
    postId: text("post_id").notNull(),
    email: text("email").notNull(),
    emoji: text("emoji").notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.email, t.emoji] }), index("post_reactions_game").on(t.gameId)],
);

/** Each person's vote in a Game's Worst Gift Vote: one per person, moved by replacing it. */
export const votes = sqliteTable(
  "votes",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.id),
    email: text("email").notNull(),
    giftId: text("gift_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.email] })],
);

/*
 * Usage statistics (ADR-0005). These tables are only ever added to and updated, never cleared by a delete, so the
 * counts outlive deleted Games, Organizations and people. People appear only as a keyed hash of their email.
 */

/** Secrets the app makes for itself on first start, such as the key for hashing emails in the statistics. */
export const appKeys = sqliteTable("app_keys", {
  name: text("name").primaryKey(),
  value: text("value").notNull(),
});

/** One row per Game ever created: counts and times, refreshed as it's played and taken just before it's deleted. */
export const gameStats = sqliteTable("game_stats", {
  gameId: text("game_id").primaryKey(),
  name: text("name").notNull(),
  /** The Host, as a keyed hash of their email. */
  hostKey: text("host_key").notNull(),
  orgId: text("org_id"),
  demo: integer("demo", { mode: "boolean" }).notNull(),
  /** Hosted from a test address (@example.com): the smoke test's, or Claude's. */
  test: integer("test", { mode: "boolean" }).notNull(),
  /** Left out of the statistics by hand, on the admin page: Jim's own trial runs. */
  excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  /** The first Pick: when the party really began (a Game may be set up days before). */
  firstPickAt: integer("first_pick_at", { mode: "timestamp_ms" }),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  lastMoveAt: integer("last_move_at", { mode: "timestamp_ms" }),
  /** Play time from the first Pick, leaving out any gap of over 30 minutes between moves (dinner, say). */
  activeMs: integer("active_ms").notNull().default(0),
  players: integer("players").notNull().default(0),
  /** Players who signed up on their own phones. */
  signedInPlayers: integer("signed_in_players").notNull().default(0),
  picks: integer("picks").notNull().default(0),
  steals: integer("steals").notNull().default(0),
  finalRound: integer("final_round", { mode: "boolean" }).notNull().default(false),
  posts: integer("posts").notNull().default(0),
  photos: integer("photos").notNull().default(0),
  votes: integer("votes").notNull().default(0),
  cohosts: integer("cohosts").notNull().default(0),
  undos: integer("undos").notNull().default(0),
  skips: integer("skips").notNull().default(0),
  /** Gifts that reached the Steal limit. */
  frozenGifts: integer("frozen_gifts").notNull().default(0),
  voteUsed: integer("vote_used", { mode: "boolean" }).notNull().default(false),
  selfSignup: integer("self_signup", { mode: "boolean" }).notNull().default(false),
  /** The most screens (phones, the scoreboard, the console) watching the Game live at once. */
  peakScreens: integer("peak_screens").notNull().default(0),
  /** How the Host chose the options at creation: "recommended", "customized" or "saved"; null from before it was asked. */
  startChoice: text("start_choice"),
  /** They opened the full list of options at creation, whatever they then chose. */
  lookedAtOptions: integer("looked_at_options", { mode: "boolean" }).notNull().default(false),
  /** The options the Game was created with, and as they are now (both GameOptions, JSON). */
  optionsAtStart: text("options_at_start"),
  options: text("options"),
  /** Turns taken (called up, or stolen from, until their Pick), their total time, and how many outran the timer. */
  turns: integer("turns").notNull().default(0),
  turnMs: integer("turn_ms").notNull().default(0),
  turnsOverTimer: integer("turns_over_timer").notNull().default(0),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** Features a Game used that its log doesn't show: "rosterPaste", "ownLook", "screen:rules" and so on. */
export const gameFeatures = sqliteTable(
  "game_features",
  {
    gameId: text("game_id").notNull(),
    feature: text("feature").notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.feature] })],
);

/** Running counts a day at a time, such as "signInEmails" (the links themselves are swept after a day). */
export const dailyCounts = sqliteTable(
  "daily_counts",
  {
    day: text("day").notNull(),
    name: text("name").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.name] })],
);

/**
 * Today's secret for telling visitors apart (see visitors.ts): a new one each day, deleted the next, so a day's
 * fingerprints can never be linked to another day's, or worked back to anyone.
 */
export const visitorDays = sqliteTable("visitor_days", {
  day: text("day").primaryKey(),
  secret: text("secret").notNull(),
});

/** The day's fingerprints of the visitors seen (a keyed hash of their address and browser), deleted the next day. */
export const visitorsSeen = sqliteTable(
  "visitors_seen",
  {
    day: text("day").notNull(),
    fingerprint: text("fingerprint").notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.fingerprint] })],
);

/** One row per person who ever signed in, as a keyed hash of their email; never their address. */
export const peopleStats = sqliteTable("people_stats", {
  personKey: text("person_key").primaryKey(),
  firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
  /** Where they first came from (?ref= on the link they followed, such as "linkedin"), if anywhere. */
  ref: text("ref"),
  test: integer("test", { mode: "boolean" }).notNull(),
});

/** One row per Organization ever created. */
export const orgStats = sqliteTable("org_stats", {
  orgId: text("org_id").primaryKey(),
  name: text("name").notNull(),
  organizerKey: text("organizer_key").notNull(),
  test: integer("test", { mode: "boolean" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
});

/** Visits by where they came from (?ref=), a day at a time; each browser counted once per source. */
export const refVisits = sqliteTable(
  "ref_visits",
  {
    day: text("day").notNull(),
    ref: text("ref").notNull(),
    visits: integer("visits").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.ref] })],
);

/**
 * What Hosts and guests said (docs/stats-plan.md, Phase 3): a Host's rating of a finished Game, a guest's thumbs up
 * or down, or a suggestion from the home screen. Kept like the statistics: never cleared by a delete, and the person
 * only as a keyed hash of their email. One answer per person per Game, which they may change.
 */
export const feedback = sqliteTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["host", "guest", "suggestion"] }).notNull(),
    /** The Game it's about; null for a suggestion. */
    gameId: text("game_id"),
    personKey: text("person_key").notNull(),
    /** A Host's 1–5 stars. */
    rating: integer("rating"),
    /** A Host's "Would you use it again?" */
    again: text("again", { enum: ["yes", "maybe", "no"] }),
    /** A guest's thumbs. */
    thumbs: text("thumbs", { enum: ["up", "down"] }),
    comment: text("comment"),
    /**
     * For a message from the contact form: the address its sender gave for a reply, if any. Kept only so Jim can
     * answer; never counted or shown anywhere else.
     */
    replyTo: text("reply_to"),
    /** They said their comment may be quoted on the website, under `quoteName` (as they wrote it). */
    quoteOk: integer("quote_ok", { mode: "boolean" }).notNull().default(false),
    quoteName: text("quote_name"),
    /** Jim chose to show it on the front page. Cleared if they change the words or take back their OK. */
    published: integer("published", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("feedback_once").on(t.kind, t.gameId, t.personKey),
    check("feedback_kind", sql`${t.kind} IN ('host', 'guest', 'suggestion')`),
    check("feedback_rating", sql`${t.rating} IS NULL OR ${t.rating} BETWEEN 1 AND 5`),
  ],
);

/** Follow-up emails asking a Host how their Game went: one per Game, ever. */
export const feedbackEmails = sqliteTable("feedback_emails", {
  gameId: text("game_id").primaryKey(),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }).notNull(),
});

/** Opens the database, bringing its tables up to date with any migrations it hasn't had yet. */
export function openDb(path: string) {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite);
  // Migrations generated by drizzle-kit from the tables above (`npm run db:generate`). Worked out here, not when
  // this file loads: drizzle-kit loads it without import.meta.dirname. And a plain path, not
  // `new URL(..., import.meta.url)`, which Vite rewrites as a browser asset in the web tests.
  //
  // Foreign keys stay off while migrating. Some migrations rebuild a table (copy, drop, rename); dropping
  // `games` while other tables point at it fails with them on, and the PRAGMA drizzle-kit writes into those
  // migrations to turn them off does nothing inside the transaction each migration runs in. This is SQLite's
  // own procedure for changing a table: check every reference still holds afterwards, then turn them on.
  sqlite.pragma("foreign_keys = OFF");
  migrate(db, { migrationsFolder: join(import.meta.dirname, "../drizzle") });
  const broken = sqlite.pragma("foreign_key_check") as unknown[];
  if (broken.length > 0) throw new Error(`Migrating left ${broken.length} broken references: ${JSON.stringify(broken.slice(0, 5))}`);
  sqlite.pragma("foreign_keys = ON");
  return db;
}

export type Db = ReturnType<typeof openDb>;
/** What a transaction's callback is handed. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
