import type { Command, GameOptions, GameSettings, Phase, RuleErrorCode } from "@elephant/rules";
import { io } from "socket.io-client";

/** A Game as the server shows it (see view() in the server). */
export interface GameView {
  id: string;
  /** What the Host calls it. */
  name: string;
  /** A line under the name on the big screen and the Host's banner, such as "It's going to be a gas!"; "" for none. */
  tagline: string;
  /** Made with "Try a demo game": its Host console links to the demo view. */
  demo: boolean;
  /** Who adds Players: only the Host and Co-hosts, or people themselves from their phones too. */
  rosterMode: RosterMode;
  /** The Game's rule for Posts; the Host or a Co-host can switch it at any moment. */
  moderation: Moderation;
  /** For a tough crowd: names people pick for themselves wait for the Host or a Co-host to approve them. */
  approveNames: boolean;
  /** Against flooding the Feed: the most Posts a guest makes in a minute, and minutes between pitching a Gift again (0: no limit). */
  postsPerMinute: number;
  repitchMinutes: number;
  /** The turn timer: the server's time when sent, the countdown's length (0: no timer), and when each Player up was called. */
  clock: { now: number; turnSeconds: number; startedAt: Record<string, number> };
  /** Rises with every change; the newest copy wins. */
  version: number;
  phase: Phase;
  settings: GameSettings;
  players: { id: string; name: string }[];
  active: string[];
  onDeck: string[];
  /** In the order opened. One opened without a name is called "Ann's gift" (by who opened it), with `named` false, until named. */
  gifts: { id: string; name: string; named: boolean; description: string; holderId: string | null; steals: number; frozen: boolean }[];
  /** Unopened Gifts still on the table in the Final Round. */
  leftoverGifts: number;
  /** What the big screen shows, as the Host switches it: the Gift board, the rules, the join code, or the catalog. */
  screen: ScreenMode;
  /** How the Game looks: its Organization's Theme with the Game's own overrides; null parts use the app's look. */
  theme: Theme;
  /** The Worst Gift Vote. `counts` is null while they're kept from everyone (Hidden or Parade, before the reveal). */
  vote: { status: VoteStatus; display: VoteDisplay; cast: number; counts: Record<string, number> | null; winner: string | null };
  /** Whether the person looking runs this Game. */
  role: "host" | "cohost" | null;
  /** The Player the person looking signed up as, if they did. */
  me: { playerId: string } | null;
  /**
   * The name the person looking goes by here (a Player's, or the one a Guest posts as; null until they give one), and
   * whether the Host or a Co-host has locked it. Null when nobody is signed in.
   */
  myName: { name: string | null; locked: boolean; pending: string | null } | null;
  /** Whether the Host or a Co-host has muted the person looking: they can't post or reply here. */
  muted: boolean;
  /** The Gift the person looking voted the worst, if they have. */
  myVote: string | null;
}

export interface Theme {
  organization: { id: string; name: string } | null;
  /** Colors as "#rrggbb". */
  color: string | null;
  page: string | null;
  logoUrl: string | null;
  backgroundUrl: string | null;
  /** Which parts are the Game's own, overriding its Organization's. */
  overrides: Record<"color" | "page" | "logo" | "background", boolean>;
}

/** An Organization the signed-in person is the Organizer of, with its Theme. */
export interface MyOrg {
  id: string;
  name: string;
  color: string | null;
  page: string | null;
  logoUrl: string | null;
  backgroundUrl: string | null;
}

export type ThemeImage = "logo" | "background";
/** A change to Theme colors: a color sets that part, null hands it back (to the Organization, or the app). */
/** The server turned a new Game away for now, to keep the parties under way smooth (see the overload guard). */
export class ServerBusy extends Error {
  constructor() {
    super("The server is too busy for a new Game right now");
  }
}

/** What a Host is told when their new Game is turned away for now. */
export const BUSY_MESSAGE =
  "Elephant Exchange is very busy right now with parties under way. Please try again in a few minutes; Games already running aren't affected.";

export type ColorChange = { color?: string | null; page?: string | null };

export type VoteStatus = "none" | "open" | "closed";
export type VoteDisplay = "live" | "hidden" | "parade";
export type ScreenMode = "gifts" | "rules" | "qr" | "catalog" | "highlights";

export type RosterMode = "host" | "self";
export type Moderation = "open" | "approval" | "paused";

/**
 * Who's signed in: whether a feedback email is OK, whether they've read and considered Jim's tip note (New Game
 * shows it until then), and whether they may use the admin pages.
 */
export interface Session {
  email: string;
  feedbackOk: boolean;
  tipNoteRead: boolean;
  admin: boolean;
  /** Their own Game options, saved with "Always start with these settings" (null if never saved). */
  myOptions: GameOptions | null;
  /** New Game uses `myOptions` straight away. */
  alwaysMyOptions: boolean;
  /** Trying the demo without signing in: demo Games only, until they sign in with their email. */
  visitor?: boolean;
}

/** How a Host chose a new Game's options, for the statistics. */
export type StartChoice = "recommended" | "customized" | "saved";

export interface NewGameRequest {
  name?: string;
  orgId?: string | undefined;
  options: GameOptions;
  start?: StartChoice;
  /** They opened the full list of options. */
  looked?: boolean;
  /** "Always start with these settings", ticked (true) or not (false); left out when the list wasn't shown. */
  remember?: boolean;
  demo?: boolean;
}

export interface AdminPerson {
  email: string;
  firstSeen: string;
  lastSignIn: string | null;
  feedbackOk: boolean;
  tipNoteRead: boolean;
  games: number;
  demoGames: number;
  organizations: string[];
}

/** The usage statistics (ADR-0005), as the admin's Stats page shows them. */
/** Whether this person is asked how a Game went (as its Host, or as a guest), and what they said. */
export interface FeedbackAsk {
  asked: boolean;
  as: "host" | "guest";
  given: {
    rating: number | null;
    again: "yes" | "maybe" | "no" | null;
    thumbs: "up" | "down" | null;
    comment: string | null;
    quoteOk: boolean;
    quoteName: string | null;
  } | null;
}
export type FeedbackAnswer = {
  rating?: number;
  again?: "yes" | "maybe" | "no";
  thumbs?: "up" | "down";
  comment?: string;
  /** "You may quote this on the website", under this name. */
  quoteOk?: boolean;
  quoteName?: string;
};

/** Someone's own words on the front page, published by Jim with their OK. */
export interface Testimonial {
  quote: string;
  name: string | null;
  kind: "host" | "guest";
  rating: number | null;
}

export type RecordKind = "players" | "longest" | "steals" | "peakScreens" | "photos";
export interface GameRecord {
  record: RecordKind;
  top: { id: string; name: string; host: string | null; playedAt: string; value: number; players: number; minutes: number | null; activeMinutes: number | null }[];
}

/** What Hosts and guests said, for the admin. */
export interface FeedbackSummary {
  averageRating: number | null;
  ratings: number;
  again: { yes: number; maybe: number; no: number };
  thumbs: { up: number; down: number };
  suggestions: number;
  items: {
    id: string;
    quoteOk: boolean;
    quoteName: string | null;
    published: boolean;
    kind: "host" | "guest" | "suggestion";
    game: string | null;
    from: string | null;
    rating: number | null;
    again: "yes" | "maybe" | "no" | null;
    thumbs: "up" | "down" | null;
    comment: string | null;
    /** For a contact-form message: where to reply, if they gave an address. */
    replyTo: string | null;
    at: string;
  }[];
}

export interface StatsInsights {
  funnel: { step: "signedIn" | "created" | "started" | "finished" | "voted"; people: number }[];
  engagement: { averagePlayers: number | null; signedInShare: number | null; averagePeakScreens: number | null };
  gameplay: {
    averageSteals: number | null;
    averageFrozenGifts: number | null;
    finalRoundShare: number | null;
    voteShare: number | null;
    averageSecondsPerPick: number | null;
    undosPerGame: number | null;
    skipsPerGame: number | null;
  };
  features: { feature: string; games: number }[];
  returningHosts: { returning: number; hosts: number };
  startTimes: string[];
  costs: { signInEmails: { day: string; count: number }[]; signInEmailCap: number; photoBytes: number };
  /** People who tried the demo without signing in, per day for the last 14 days. */
  demoVisitors: { day: string; count: number }[];
  setup: {
    choices: { choice: "recommended" | "customized" | "saved" | "unknown"; games: number; looked: number }[];
    options: {
      option: string;
      recommended: string;
      atStart: { value: string; games: number }[];
      atEnd: { value: string; games: number }[];
      changedLater: number;
    }[];
    timer: { seconds: number; games: number; turns: number; averageTurnSeconds: number | null; overTimerShare: number | null }[];
  };
}

export interface StatsSummary {
  insights: StatsInsights;
  records: GameRecord[];
  totals: {
    hosts: number;
    hostsWhoCreated: number;
    organizations: number;
    gamesCreated: number;
    gamesPlayed: number;
    gamesFinished: number;
    people: number;
    players: number;
    signedInPlayers: number;
    averageMinutes: number | null;
    averageActiveMinutes: number | null;
  };
  hosts: { email: string | null; games: number; averageMinutes: number | null }[];
  organizations: { name: string; deleted: boolean; games: number }[];
  sources: { ref: string; visits: number; signUps: number }[];
  games: {
    id: string;
    name: string;
    host: string | null;
    createdAt: string;
    firstPickAt: string | null;
    endedAt: string | null;
    minutes: number | null;
    activeMinutes: number | null;
    players: number;
    picks: number;
    steals: number;
    rating: number | null;
    demo: boolean;
    test: boolean;
    excluded: boolean;
    deleted: boolean;
    played: boolean;
    counted: boolean;
  }[];
}

export interface AdminGame {
  id: string;
  name: string;
  demo: boolean;
  host: string;
  phase: "setup" | "playing" | "finalRound" | "ended";
  players: number;
  createdAt: string;
}

/**
 * The Reactions anyone can put on a Post, in the order they're shown, each with the name a screen reader says.
 * `emoji` is what the server knows it by: the emoji itself, or for the leg lamp (which has none) a name the app
 * draws an icon for.
 */
export const REACTIONS = [
  { emoji: "👍", name: "Like" },
  { emoji: "❤️", name: "Love" },
  { emoji: "😂", name: "Funny" },
  { emoji: "🎉", name: "Hooray" },
  { emoji: "🔥", name: "Fire" },
  { emoji: "😮", name: "Wow" },
  { emoji: "⛄", name: "Snowman" },
  { emoji: "leg-lamp", name: "Leg lamp" },
] as const;
export type Emoji = (typeof REACTIONS)[number]["emoji"];

/** Someone the Game knows, as the Host's Co-hosts panel shows them: by name where there is one, never by email. */
export interface Person {
  /** Names them to the server when switching them on or off. */
  key: string;
  /** Their Player's name, or what they post as; null when they've only opened the Game. */
  name: string | null;
  /** Enough of their email to tell two of the same name apart: "te…@example.com". */
  hint: string;
  /** The Player they play as, if any. */
  playerId: string | null;
  role: "host" | "cohost" | null;
  /** Whether this is the Host looking. */
  you: boolean;
}

/** A Player who is also the Host or a Co-host, marked on their consoles. */
export interface StaffMember {
  playerId: string;
  role: "host" | "cohost";
}

/** A Post in the Feed, as this viewer may see it. */
export interface Post {
  id: string;
  /** The name it was posted as. */
  author: string;
  /** The Gift it's about, if the poster said. */
  giftId: string | null;
  /** Empty when the Post is just a Photo. */
  text: string;
  /** Its Photo, if it has one: where to load it, and its size (so the page can make room before it loads). */
  /** The Photo full size (url) and as a small copy for lists and thumbnails (smallUrl). */
  photo: { url: string; smallUrl: string; width: number; height: number } | null;
  /** Pending and Hidden Posts reach only their poster and the Hosts. */
  status: "visible" | "pending" | "hidden";
  createdAt: number;
  /** Whether the viewer posted it. */
  mine: boolean;
  /** The Reactions it has, in the order they're offered (none with no count), and whether the viewer put each on. */
  reactions: { emoji: Emoji; count: number; mine: boolean }[];
  /** For a reply, the Post it answers, quoted; or just `removed` once the viewer can no longer see that Post. */
  replyTo: Quote | null;
  /** How many replies to it everyone can see. */
  replies: number;
  /** For the Host and Co-hosts only: whether its poster is muted. */
  authorMuted?: boolean;
  /** Set when it's a part of its Gift's Pitch: the Player whose part it is. */
  pitchFor: string | null;
  /** A Pitch part's bold headline. */
  tagline?: string | null;
  /** When a Pitch part was last sent to the top of the Feed again. */
  bumpedAt?: number | null;
}

/** Whose name the Host or a Co-host is changing: a Player, whoever wrote a Post, or someone whose name is waiting. */
export type RenameWho = { playerId: string } | { postId: string } | { key: string };

/** A name someone asked for under Approve names: `shown` is what everyone sees meanwhile. */
export interface PendingName {
  key: string;
  shown: string;
  wants: string;
  playerId: string | null;
}

/** The Post a reply answers, as shown above the reply. */
export type Quote = Pick<Post, "id" | "author" | "text" | "photo"> | { id: string; removed: true };

/** What only the person looking is told about a Game; live updates go to everyone, so they never carry it. */
export type Viewer = Pick<GameView, "role" | "me" | "myName" | "muted" | "myVote">;
export type SharedGame = Omit<GameView, keyof Viewer>;

/**
 * A page of this app to come back to after signing in. Paths only: "//host" and "/\\host" would take a
 * browser to another site. The server checks the same.
 */
export const isReturnPath = (path: string) => /^\/(?![/\\])[\x21-\x7e]*$/.test(path) && path.length <= 200;

/** One of the Games a person runs, as listed on their home screen. */
export interface MyGame {
  id: string;
  name: string;
  phase: Phase;
  players: number;
  role: "host" | "cohost";
}

export type CommandResult = { ok: true; game: SharedGame } | { ok: false; code: RuleErrorCode | "Forbidden" | "Failed"; message: string };

export interface ApiOptions {
  /** Where live updates come from; the page's own origin when left out. */
  socketOrigin?: string;
  /** Socket.IO transports; left out, it starts with polling and upgrades, which gets through strict networks. */
  transports?: ("polling" | "websocket")[];
  /** What's kept on this device (Stars); the browser's localStorage when left out. */
  storage?: DeviceStorage;
  /** This device's clock (ms since 1970), which may be wrong; Date.now when left out. */
  now?: () => number;
  /**
   * The made-up Player this is, on the demo page's sample phone (Demo.tsx): the Host's own browser, acting as that
   * Player of a demo Game the Host runs. It counts as signed in, as that Player.
   */
  demoPlayer?: string;
  /** The build of the app running here (see buildOfPage); left out, as in development, it never asks to reload. */
  build?: string;
  /** Loads the page afresh; window.location.reload when left out. */
  reload?: () => void;
}

/** The build this page is running: the hash in its main script's name (index-<hash>.js), as the server works it out. */
export function buildOfPage(doc: Document = document): string | undefined {
  for (const script of doc.querySelectorAll<HTMLScriptElement>("script[src]")) {
    const hash = /\/assets\/index-([\w-]+)\.js/.exec(script.src)?.[1];
    if (hash) return hash;
  }
  return undefined;
}

export type DeviceStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * localStorage, or nothing if the browser won't allow it (some private windows throw): Stars then last
 * until the page is closed, which is fine for a party.
 */
function browserStorage(): DeviceStorage {
  const kept = new Map<string, string>();
  return {
    getItem: (key) => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return kept.get(key) ?? null;
      }
    },
    setItem: (key, value) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        kept.set(key, value);
      }
    },
  };
}

/** Talks to the server. Screens use this, never fetch directly, so tests can hand in a browser with a cookie jar. */
export function createApi(fetchFn: typeof fetch = (input, init) => fetch(input, init), options: ApiOptions = {}) {
  const { demoPlayer } = options;
  const ownFetch = fetchFn; // before any demo Player is added, for `as`
  if (demoPlayer !== undefined) {
    // The demo page's sample phone: every request says which made-up Player it is; the server checks it may be.
    const plain = fetchFn;
    fetchFn = (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("x-demo-player", demoPlayer);
      return plain(input, { ...init, headers });
    };
  }
  // Every answer names the server's current build: once it isn't this page's, a newer app is out (a deploy).
  let newBuild: string | null = null;
  const newBuildWatchers = new Set<() => void>();
  if (options.build !== undefined) {
    const ours = options.build;
    const plain = fetchFn;
    fetchFn = async (input, init) => {
      const res = await plain(input, init);
      const live = res.headers.get("x-app-build");
      if (live && live !== ours && live !== newBuild) {
        newBuild = live;
        for (const watcher of newBuildWatchers) watcher();
      }
      return res;
    };
  }
  const storage = options.storage ?? browserStorage();
  const starsKey = (gameId: string) => `stars:${gameId}`;
  const now = options.now ?? (() => Date.now());

  const postJson = (path: string, body?: unknown) =>
    fetchFn(path, {
      method: "POST",
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });

  const sendJson = (method: string, path: string, body: unknown) =>
    fetchFn(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  /** PUTs an image as a multipart form, or DELETEs it when there's none. */
  const sendImage = (path: string, image: Blob | null) => {
    if (!image) return fetchFn(path, { method: "DELETE" });
    const form = new FormData();
    form.append("image", image, "image");
    return fetchFn(path, { method: "PUT", body: form });
  };

  return {
    /** This device's clock. */
    now,

    /**
     * This same browser acting as one of its demo Game's made-up Players, as the demo page's sample phone does: for
     * the Host to fill a new demo with what its guests might say (see Demo.tsx).
     */
    as(playerId: string): DemoActor {
      const { build: _ours, ...rest } = options; // the page itself watches for a new build
      return createApi(ownFetch, { ...rest, demoPlayer: playerId });
    },

    /** The newer build the server has, once an answer shows this page is out of date; null until then. */
    newBuild: () => newBuild,
    /** Calls `watcher` when a newer build turns up; returns how to stop. */
    onNewBuild(watcher: () => void): () => void {
      newBuildWatchers.add(watcher);
      return () => newBuildWatchers.delete(watcher);
    },
    /** Loads the page afresh, which picks up the newest build. */
    reloadPage: options.reload ?? (() => window.location.reload()),

    /** Who is signed in on this browser, if anyone. */
    async session(): Promise<Session | undefined> {
      if (demoPlayer !== undefined) return { email: "", feedbackOk: false, tipNoteRead: false, admin: false, myOptions: null, alwaysMyOptions: false };
      const res = await fetchFn("/api/session");
      if (res.status === 401) return undefined;
      if (!res.ok) throw new Error(`session check failed: ${res.status}`);
      return (await res.json()) as Session;
    },

    /** The signed-in person has read and considered Jim's tip note: New Game stops showing it, on every device. */
    async markTipNoteRead(): Promise<boolean> {
      return (await postJson("/api/me/tip-note-read", {})).ok;
    },

    /** Says whether it's OK to email the signed-in person to ask how it went. */
    async setFeedbackOk(ok: boolean): Promise<boolean> {
      return (await postJson("/api/me/feedback", { ok })).ok;
    },

    /**
     * `next`: the page of this app the emailed link should bring them back to. `feedbackOk`: they ticked "OK to
     * email me for feedback".
     */
    async requestLink(email: string, next?: string, feedbackOk = false): Promise<"sent" | "tooMany" | "invalidEmail"> {
      const ref = storage.getItem("ref");
      const res = await postJson("/api/auth/link", {
        email,
        ...(next === undefined ? {} : { next }),
        ...(feedbackOk ? { feedbackOk } : {}),
        ...(ref ? { ref } : {}),
      });
      if (res.status === 202) return "sent";
      if (res.status === 429) return "tooMany";
      if (res.status === 400) return "invalidEmail";
      throw new Error(`asking for a link failed: ${res.status}`);
    },

    /** Uses up an emailed link; undefined if it was already used or has expired. */
    async redeemLink(token: string): Promise<{ email: string } | undefined> {
      const res = await postJson("/api/auth/verify", { token });
      if (res.status === 401 || res.status === 400) return undefined;
      if (!res.ok) throw new Error(`signing in failed: ${res.status}`);
      return (await res.json()) as { email: string };
    },

    /** Changes a Game's name, turn timer or who adds the Players; only those given. */
    async setGameOptions(
      gameId: string,
      options: { name?: string; tagline?: string; turnSeconds?: number; rosterMode?: RosterMode; approveNames?: boolean; postsPerMinute?: number; repitchMinutes?: number },
    ): Promise<SharedGame | undefined> {
      const res = await sendJson("PATCH", `/api/games/${encodeURIComponent(gameId)}/options`, options);
      return res.ok ? ((await res.json()) as SharedGame) : undefined;
    },

    /** The admin pages' lists: "notFound" for anyone who isn't an admin. */
    async adminPeople(): Promise<AdminPerson[] | "notFound"> {
      const res = await fetchFn("/api/admin/people");
      if (res.status === 404) return "notFound";
      if (!res.ok) throw new Error(`listing people failed: ${res.status}`);
      return (await res.json()) as AdminPerson[];
    },

    async adminStats(): Promise<StatsSummary | "notFound"> {
      const res = await fetchFn("/api/admin/stats");
      if (res.status === 404) return "notFound";
      if (!res.ok) throw new Error(`loading the statistics failed: ${res.status}`);
      return (await res.json()) as StatsSummary;
    },

    /** Leaves a Game out of the statistics (a trial run), or puts it back. */
    async adminExcludeFromStats(gameId: string, excluded: boolean): Promise<boolean> {
      return (await postJson(`/api/admin/stats/games/${encodeURIComponent(gameId)}`, { excluded })).ok;
    },

    /** Whether the signed-in person is asked how this Game went; null when signed out. */
    async feedbackFor(gameId: string): Promise<FeedbackAsk | null> {
      const res = await fetchFn(`/api/games/${encodeURIComponent(gameId)}/feedback`);
      if (!res.ok) return null;
      return (await res.json()) as FeedbackAsk;
    },

    async giveFeedback(gameId: string, answer: FeedbackAnswer): Promise<boolean> {
      return (await postJson(`/api/games/${encodeURIComponent(gameId)}/feedback`, answer)).ok;
    },

    async suggest(comment: string): Promise<boolean> {
      return (await postJson("/api/feedback/suggestions", { comment })).ok;
    },

    /**
     * Lets someone try the demo without signing in: the server gives this browser a stand-in session for demo
     * Games (someone signed in keeps theirs). Throws ServerBusy when the server is too busy for another.
     */
    async startVisitor(): Promise<void> {
      const res = await postJson("/api/demo/visitor");
      if (res.status === 503) throw new ServerBusy();
      if (!res.ok) throw new Error(`starting the demo failed: ${res.status}`);
    },

    /** A message to Jim from the contact form; `website` is the field only bots fill in. */
    async contact(message: string, replyTo: string, website = ""): Promise<"sent" | "tooMany" | "failed"> {
      try {
        const res = await postJson("/api/contact", { message, replyTo, website });
        return res.ok ? "sent" : res.status === 429 ? "tooMany" : "failed";
      } catch {
        return "failed";
      }
    },

    /** The testimonials on the front page. Empty if they can't be loaded: the page simply goes without. */
    async testimonials(): Promise<Testimonial[]> {
      try {
        const res = await fetchFn("/api/testimonials");
        return res.ok ? ((await res.json()) as Testimonial[]) : [];
      } catch {
        return [];
      }
    },

    /** The admin puts a testimonial on the front page, or takes it down. */
    async publishFeedback(id: string, published: boolean): Promise<boolean> {
      return (await postJson(`/api/admin/feedback/${encodeURIComponent(id)}/published`, { published })).ok;
    },

    async adminFeedback(): Promise<FeedbackSummary | "notFound"> {
      const res = await fetchFn("/api/admin/feedback");
      if (res.status === 404) return "notFound";
      if (!res.ok) throw new Error(`loading the feedback failed: ${res.status}`);
      return (await res.json()) as FeedbackSummary;
    },

    /** Tells the statistics a Game used a feature only the browser sees, such as pasting the roster. */
    noteFeature(gameId: string, feature: "rosterPaste" | "share") {
      void postJson(`/api/games/${encodeURIComponent(gameId)}/features`, { feature }).catch(() => {});
    },

    /**
     * Notes where this browser arrived from, if the page's address says (?ref=linkedin): the first source is kept,
     * to go with a sign-in later, and each source is counted once per browser.
     */
    noteArrival(search: string) {
      const ref = new URLSearchParams(search).get("ref")?.toLowerCase();
      if (!ref || !/^[a-z0-9_-]{1,32}$/.test(ref)) return;
      if (!storage.getItem("ref")) storage.setItem("ref", ref);
      const seen = storage.getItem("refsSeen")?.split(",") ?? [];
      if (seen.includes(ref)) return;
      storage.setItem("refsSeen", [...seen, ref].join(","));
      void postJson("/api/stats/visit", { ref }).catch(() => {});
    },

    async adminGames(): Promise<AdminGame[] | "notFound"> {
      const res = await fetchFn("/api/admin/games");
      if (res.status === 404) return "notFound";
      if (!res.ok) throw new Error(`listing games failed: ${res.status}`);
      return (await res.json()) as AdminGame[];
    },

    async adminDeleteGame(id: string): Promise<boolean> {
      return (await fetchFn(`/api/admin/games/${encodeURIComponent(id)}`, { method: "DELETE" })).ok;
    },

    /** Deletes the smoke test's @example.com people, their Games and Organizations; says how many of each. */
    async adminDeleteTestData(): Promise<{ people: number; games: number; organizations: number } | undefined> {
      const res = await postJson("/api/admin/test-data/delete", {});
      return res.ok ? ((await res.json()) as { people: number; games: number; organizations: number }) : undefined;
    },

    async signOut(): Promise<void> {
      await postJson("/api/auth/sign-out");
    },

    async createGame({ name, orgId, options, start, looked, remember, demo }: NewGameRequest): Promise<string> {
      const { activeSlots, maxSteals, ...rest } = options;
      const res = await postJson("/api/games", {
        settings: { activeSlots, maxSteals },
        ...rest,
        ...(name === undefined ? {} : { name }),
        ...(orgId ? { orgId } : {}),
        ...(start ? { start } : {}),
        ...(looked ? { looked } : {}),
        ...(remember === undefined ? {} : { remember }),
        ...(demo ? { demo } : {}),
      });
      if (res.status === 503) throw new ServerBusy();
      if (res.status !== 201) throw new Error(`creating a Game failed: ${res.status}`);
      return ((await res.json()) as { id: string }).id;
    },

    /** The Games the signed-in person runs, newest first. */
    async myGames(): Promise<MyGame[]> {
      const res = await fetchFn("/api/games");
      if (!res.ok) throw new Error(`listing Games failed: ${res.status}`);
      return (await res.json()) as MyGame[];
    },

    /** The Game, or undefined if there's no such Game. */
    async game(id: string): Promise<GameView | undefined> {
      const res = await fetchFn(`/api/games/${encodeURIComponent(id)}`);
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`loading the Game failed: ${res.status}`);
      return (await res.json()) as GameView;
    },

    /** Makes an email a Co-host; `playsAs` links it to a Player the Host typed in, who hasn't signed in yet. */
    async addCohost(gameId: string, email: string, playsAs?: string): Promise<void> {
      const res = await postJson(`/api/games/${encodeURIComponent(gameId)}/cohosts`, { email, ...(playsAs ? { playsAs } : {}) });
      if (res.status !== 204) throw new Error(`adding a Co-host failed: ${res.status}`);
    },

    /** Everyone the Game knows, for the Host's Co-hosts panel. */
    async people(gameId: string): Promise<Person[]> {
      const res = await fetchFn(`/api/games/${encodeURIComponent(gameId)}/people`);
      if (!res.ok) throw new Error(`loading the people failed: ${res.status}`);
      return ((await res.json()) as { people: Person[] }).people;
    },

    /** The Host switches someone's Co-host role on or off, or says which Player they play as (null: none). */
    async setPerson(gameId: string, key: string, change: { cohost?: boolean; playsAs?: string | null }): Promise<void> {
      const res = await postJson(`/api/games/${encodeURIComponent(gameId)}/people/${encodeURIComponent(key)}`, change);
      if (res.status !== 204) throw new Error(`changing a Co-host failed: ${res.status}`);
    },

    /** Which Players are the Host or a Co-host, for their consoles. */
    async staff(gameId: string): Promise<StaffMember[]> {
      const res = await fetchFn(`/api/games/${encodeURIComponent(gameId)}/staff`);
      if (!res.ok) throw new Error(`loading the Co-hosts failed: ${res.status}`);
      return ((await res.json()) as { staff: StaffMember[] }).staff;
    },

    /** The Game's Co-hosts' emails (the Host isn't among them). */
    async cohosts(gameId: string): Promise<string[]> {
      const res = await fetchFn(`/api/games/${encodeURIComponent(gameId)}/cohosts`);
      if (!res.ok) throw new Error(`loading the Co-hosts failed: ${res.status}`);
      return ((await res.json()) as { cohosts: string[] }).cohosts;
    },

    async removeCohost(gameId: string, email: string): Promise<void> {
      const res = await fetchFn(`/api/games/${encodeURIComponent(gameId)}/cohosts/${encodeURIComponent(email)}`, { method: "DELETE" });
      if (res.status !== 204) throw new Error(`removing a Co-host failed: ${res.status}`);
    },

    /**
     * Calls onGame with the whole Game now, and again after every change, until the returned function is called.
     * After a phone sleeps, Socket.IO reconnects by itself and the server sends the whole Game again.
     */
    watch(
      gameId: string,
      onGame: (game: SharedGame) => void,
      onMissing?: () => void,
      onPostsChanged?: () => void,
      onStaffChanged?: () => void,
    ): () => void {
      const socketOptions = { auth: { gameId }, ...(options.transports ? { transports: options.transports } : {}) };
      const socket = options.socketOrigin ? io(options.socketOrigin, socketOptions) : io(socketOptions);
      socket.on("game", onGame);
      if (onPostsChanged) socket.on("posts", onPostsChanged);
      if (onStaffChanged) socket.on("staff", onStaffChanged);
      socket.on("connect_error", (err) => {
        if (err.message === "Game not found") {
          socket.close();
          onMissing?.();
        }
      });
      return () => void socket.close();
    },

    /** Adds the signed-in person to a Self sign-up Game as a Player with this name. */
    async join(gameId: string, name: string): Promise<{ ok: true; game: SharedGame; me: { playerId: string } } | { ok: false; message: string }> {
      const res = await postJson(`/api/games/${encodeURIComponent(gameId)}/join`, { name });
      if (res.ok) {
        const { me, ...game } = (await res.json()) as SharedGame & { me: { playerId: string } };
        return { ok: true, game, me };
      }
      if (res.status === 409) return { ok: false, message: ((await res.json()) as { message: string }).message };
      if (res.status === 403) return { ok: false, message: "The Host adds the Players in this Game." };
      if (res.status === 401) return { ok: false, message: "Please sign in again." };
      return { ok: false, message: "Something went wrong. Please try again." };
    },

    /** The Gifts this device has Starred in a Game. Personal: they never leave the device. */
    stars(gameId: string): string[] {
      try {
        const kept: unknown = JSON.parse(storage.getItem(starsKey(gameId)) ?? "[]");
        return Array.isArray(kept) ? kept.filter((id): id is string => typeof id === "string") : [];
      } catch {
        return [];
      }
    },

    /** The name this phone last posted or joined as, to fill in next time. Kept on the phone only. */
    guestName(): string {
      return storage.getItem("guestName") ?? "";
    },

    setGuestName(name: string): void {
      storage.setItem("guestName", name);
    },

    setStars(gameId: string, giftIds: string[]): void {
      storage.setItem(starsKey(gameId), JSON.stringify(giftIds));
    },

    /** The Feed as this viewer may see it, newest first. */
    async posts(gameId: string): Promise<Post[]> {
      const res = await fetchFn(`/api/games/${encodeURIComponent(gameId)}/posts`);
      if (!res.ok) throw new Error(`loading the Feed failed: ${res.status}`);
      return (await res.json()) as Post[];
    },

    /** `name` is what a Guest posts as; a Player always posts as their Player. */
    /** Posts words and/or a Photo. A Photo goes as a multipart form; words alone as JSON. */
    async post(
      gameId: string,
      { photo, ...post }: { text: string; name?: string; giftId?: string; replyTo?: string; photo?: Blob },
    ): Promise<"posted" | "paused" | "muted" | "tooSoon" | "notPhoto" | "tooBig" | "failed"> {
      const path = `/api/games/${encodeURIComponent(gameId)}/posts`;
      let res: Response;
      if (photo) {
        const form = new FormData();
        for (const [k, v] of Object.entries(post)) if (v) form.append(k, v);
        form.append("photo", photo, "photo.jpg");
        res = await fetchFn(path, { method: "POST", body: form });
      } else {
        res = await postJson(path, post);
      }
      if (res.status === 201) return "posted";
      if (res.status === 409) return ((await res.json().catch(() => ({}))) as { code?: string }).code === "Muted" ? "muted" : "paused";
      if (res.status === 429) return "tooSoon";
      if (res.status === 413) return "tooBig";
      if (res.status === 400 && photo) return "notPhoto";
      return "failed";
    },

    async setModeration(gameId: string, mode: Moderation): Promise<boolean> {
      return (await postJson(`/api/games/${encodeURIComponent(gameId)}/moderation`, { mode })).ok;
    },

    /** Puts a Reaction on a Post (`on`) or takes it back. */
    async react(gameId: string, postId: string, emoji: Emoji, on: boolean): Promise<boolean> {
      const res = await postJson(`/api/games/${encodeURIComponent(gameId)}/posts/${encodeURIComponent(postId)}/reactions`, { emoji, on });
      return res.ok;
    },

    /** Approves a Pending Post or shows a Hidden one again ("visible"), or hides it. */
    /** Says which Gift a Post is about after posting (null for none): for its poster, the Host and Co-hosts. */
    async setPostGift(gameId: string, postId: string, giftId: string | null): Promise<boolean> {
      const res = await postJson(`/api/games/${encodeURIComponent(gameId)}/posts/${encodeURIComponent(postId)}/gift`, { giftId });
      return res.status === 204;
    },

    /** Mutes or unmutes whoever wrote a Post; muting can hide all their Posts too, which unmuting brings back. */
    async mute(gameId: string, postId: string, muted: boolean, hidePosts = false): Promise<boolean> {
      return (await postJson(`/api/games/${encodeURIComponent(gameId)}/mute`, { postId, muted, ...(hidePosts ? { hidePosts } : {}) })).status === 204;
    },

    /** Changes the name the person looking goes by in this Game, unless the Host has locked it. */
    async changeMyName(gameId: string, name: string): Promise<"ok" | "waiting" | "locked" | "failed"> {
      const res = await postJson(`/api/games/${encodeURIComponent(gameId)}/me/name`, { name });
      return res.status === 204 ? "ok" : res.status === 202 ? "waiting" : res.status === 409 ? "locked" : "failed";
    },

    /** Under Approve names: the names people asked for, waiting for the Host or a Co-host. */
    async pendingNames(gameId: string): Promise<PendingName[]> {
      const res = await fetchFn(`/api/games/${encodeURIComponent(gameId)}/names/pending`);
      if (!res.ok) throw new Error(`loading the names waiting failed: ${res.status}`);
      return ((await res.json()) as { pending: PendingName[] }).pending;
    },

    async approveName(gameId: string, key: string): Promise<boolean> {
      return (await postJson(`/api/games/${encodeURIComponent(gameId)}/names/approve`, { key })).status === 204;
    },

    /** The Host or a Co-host renames a Player, or whoever wrote a Post, everywhere; `locked` keeps them from changing it. */
    async rename(gameId: string, who: RenameWho, name: string, locked: boolean): Promise<boolean> {
      const res = await postJson(`/api/games/${encodeURIComponent(gameId)}/names`, { ...who, name, locked });
      return res.status === 204;
    },

    /** Hides a Post (with every reply under it, given `thread`), or shows it again with whatever was hidden with it. */
    /** Writes, changes or (with empty text) removes a part of a Gift's Pitch: the viewer's own, or for a Host, `playerId`'s. */
    async setPitch(
      gameId: string,
      giftId: string,
      { tagline = "", text = "", photo, removePhoto }: { tagline?: string; text?: string; photo?: Blob; removePhoto?: boolean },
      playerId?: string,
    ): Promise<"saved" | "notPhoto" | "tooBig" | "failed"> {
      const path = `/api/games/${encodeURIComponent(gameId)}/gifts/${encodeURIComponent(giftId)}/pitch`;
      let res: Response;
      if (photo) {
        const form = new FormData();
        for (const [k, v] of Object.entries({ tagline, text, playerId })) if (v) form.append(k, v);
        form.append("photo", photo, "photo.jpg");
        res = await fetchFn(path, { method: "PUT", body: form });
      } else {
        res = await sendJson("PUT", path, { tagline, text, ...(removePhoto ? { removePhoto } : {}), ...(playerId ? { playerId } : {}) });
      }
      if (res.ok) return "saved";
      if (res.status === 413) return "tooBig";
      if (res.status === 400 && photo) return "notPhoto";
      return "failed";
    },

    /** "Pitch it again": back to the top of the Feed. Or how many seconds until that's allowed. */
    async repitch(gameId: string, giftId: string, playerId?: string): Promise<"sent" | { wait: number } | "failed"> {
      const res = await postJson(`/api/games/${encodeURIComponent(gameId)}/gifts/${encodeURIComponent(giftId)}/pitch/again`, playerId ? { playerId } : {});
      if (res.ok) return "sent";
      if (res.status === 429) return { wait: ((await res.json().catch(() => ({}))) as { wait?: number }).wait ?? 60 };
      return "failed";
    },

    async setPostStatus(gameId: string, postId: string, status: "visible" | "hidden", thread = false): Promise<boolean> {
      const res = await postJson(`/api/games/${encodeURIComponent(gameId)}/posts/${encodeURIComponent(postId)}/status`, {
        status,
        ...(thread ? { thread } : {}),
      });
      return res.ok;
    },

    /** Restarts a Player's countdown; the Game as it now stands, or undefined if that didn't work. */
    /** The Host deletes their own Game, with everything in it. */
    async deleteGame(id: string): Promise<boolean> {
      return (await fetchFn(`/api/games/${encodeURIComponent(id)}`, { method: "DELETE" })).ok;
    },

    /** The Organizer deletes their Organization; Games that used its look keep going. */
    async deleteOrg(id: string): Promise<boolean> {
      return (await fetchFn(`/api/orgs/${encodeURIComponent(id)}`, { method: "DELETE" })).ok;
    },

    async createOrg(name: string): Promise<string> {
      const res = await postJson("/api/orgs", { name });
      if (res.status !== 201) throw new Error(`creating an Organization failed: ${res.status}`);
      return ((await res.json()) as { id: string }).id;
    },

    /** The Organizations the signed-in person is the Organizer of. */
    async myOrgs(): Promise<MyOrg[]> {
      // Only ever offered as choices: if they can't be loaded (offline, or signed out), there are none to offer.
      const res = await fetchFn("/api/orgs").catch(() => undefined);
      return res?.ok ? ((await res.json()) as MyOrg[]) : [];
    },

    async editOrg(orgId: string, change: { name?: string } & ColorChange): Promise<MyOrg | undefined> {
      const res = await sendJson("PATCH", `/api/orgs/${encodeURIComponent(orgId)}`, change);
      return res.ok ? ((await res.json()) as MyOrg) : undefined;
    },

    /** Sets (with a file) or removes (null) an Organization's logo or background. */
    async setOrgImage(orgId: string, kind: ThemeImage, image: Blob | null): Promise<MyOrg | undefined> {
      const res = await sendImage(`/api/orgs/${encodeURIComponent(orgId)}/${kind}`, image);
      return res.ok ? ((await res.json()) as MyOrg) : undefined;
    },

    /** Picks the Organization whose Theme the Game shows (null for none). */
    async setGameOrg(gameId: string, orgId: string | null): Promise<boolean> {
      return (await postJson(`/api/games/${encodeURIComponent(gameId)}/org`, { orgId })).ok;
    },

    async editGameTheme(gameId: string, change: ColorChange): Promise<boolean> {
      return (await sendJson("PATCH", `/api/games/${encodeURIComponent(gameId)}/theme`, change)).ok;
    },

    /** Sets (with a file) or removes (null) the Game's own logo or background. */
    async setGameImage(gameId: string, kind: ThemeImage, image: Blob | null): Promise<boolean> {
      return (await sendImage(`/api/games/${encodeURIComponent(gameId)}/theme/${kind}`, image)).ok;
    },

    /** Opens or closes the vote. Closing with Gifts tied for most needs `winner`; without it, the tied Gifts come back. */
    async setVoteStatus(gameId: string, status: "open" | "closed", winner?: string): Promise<"ok" | { tied: string[] } | "failed"> {
      const res = await postJson(`/api/games/${encodeURIComponent(gameId)}/vote/status`, winner ? { status, winner } : { status });
      if (res.ok) return "ok";
      if (res.status === 409) {
        const body = (await res.json()) as { code: string; tied?: string[] };
        if (body.code === "Tie" && body.tied) return { tied: body.tied };
      }
      return "failed";
    },

    async setScreen(gameId: string, mode: ScreenMode): Promise<boolean> {
      return (await postJson(`/api/games/${encodeURIComponent(gameId)}/screen`, { mode })).ok;
    },

    async setVoteDisplay(gameId: string, display: VoteDisplay): Promise<boolean> {
      return (await postJson(`/api/games/${encodeURIComponent(gameId)}/vote/display`, { display })).ok;
    },

    /** Casts or moves this person's vote; the Gift they now vote for, or undefined if it didn't count. */
    async vote(gameId: string, giftId: string): Promise<string | undefined> {
      const res = await postJson(`/api/games/${encodeURIComponent(gameId)}/vote`, { giftId });
      return res.ok ? ((await res.json()) as { myVote: string }).myVote : undefined;
    },

    async resetTimer(gameId: string, playerId: string): Promise<SharedGame | undefined> {
      const res = await postJson(`/api/games/${encodeURIComponent(gameId)}/timer`, { playerId });
      return res.ok ? ((await res.json()) as SharedGame) : undefined;
    },

    async command(gameId: string, command: Command): Promise<CommandResult> {
      const res = await postJson(`/api/games/${encodeURIComponent(gameId)}/commands`, command);
      if (res.ok) return { ok: true, game: (await res.json()) as GameView };
      if (res.status === 409) return { ok: false, ...((await res.json()) as { code: RuleErrorCode; message: string }) };
      if (res.status === 401 || res.status === 403) return { ok: false, code: "Forbidden", message: "Only the Host and Co-hosts can do that." };
      return { ok: false, code: "Failed", message: "Something went wrong. Please try again." };
    },
  };
}

export type Api = ReturnType<typeof createApi>;
/** What a demo Game's made-up Player can do, through `Api.as`. */
export interface DemoActor {
  post: Api["post"];
  posts: Api["posts"];
  react: Api["react"];
}
