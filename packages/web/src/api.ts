import type { Command, GameSettings, Phase, RuleErrorCode } from "@elephant/rules";
import { io } from "socket.io-client";

/** A Game as the server shows it (see view() in the server). */
export interface GameView {
  id: string;
  /** What the Host calls it. */
  name: string;
  /** Made with "Try a demo game": its Host console links to the demo view. */
  demo: boolean;
  /** Who adds Players: only the Host and Co-hosts, or people themselves from their phones too. */
  rosterMode: RosterMode;
  /** The Game's rule for Posts; the Host or a Co-host can switch it at any moment. */
  moderation: Moderation;
  /** The turn timer: the server's time when sent, the countdown's length (0: no timer), and when each Player up was called. */
  clock: { now: number; turnSeconds: number; startedAt: Record<string, number> };
  /** Rises with every change; the newest copy wins. */
  version: number;
  phase: Phase;
  settings: GameSettings;
  players: { id: string; name: string }[];
  active: string[];
  onDeck: string[];
  gifts: { id: string; name: string; description: string; holderId: string | null; steals: number; frozen: boolean }[];
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
export type ColorChange = { color?: string | null; page?: string | null };

export type VoteStatus = "none" | "open" | "closed";
export type VoteDisplay = "live" | "hidden" | "parade";
export type ScreenMode = "gifts" | "rules" | "qr" | "catalog";

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
  given: { rating: number | null; again: "yes" | "maybe" | "no" | null; thumbs: "up" | "down" | null; comment: string | null } | null;
}
export type FeedbackAnswer = { rating?: number; again?: "yes" | "maybe" | "no"; thumbs?: "up" | "down"; comment?: string };

/** What Hosts and guests said, for the admin. */
export interface FeedbackSummary {
  averageRating: number | null;
  ratings: number;
  again: { yes: number; maybe: number; no: number };
  thumbs: { up: number; down: number };
  suggestions: number;
  items: {
    kind: "host" | "guest" | "suggestion";
    game: string | null;
    from: string | null;
    rating: number | null;
    again: "yes" | "maybe" | "no" | null;
    thumbs: "up" | "down" | null;
    comment: string | null;
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
}

export interface StatsSummary {
  insights: StatsInsights;
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

/** The Reactions anyone can put on a Post, in the order they're shown, each with the name a screen reader says. */
export const REACTIONS = [
  { emoji: "👍", name: "Like" },
  { emoji: "❤️", name: "Love" },
  { emoji: "😂", name: "Funny" },
  { emoji: "🎉", name: "Hooray" },
  { emoji: "🔥", name: "Fire" },
  { emoji: "😮", name: "Wow" },
] as const;
export type Emoji = (typeof REACTIONS)[number]["emoji"];

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
  photo: { url: string; width: number; height: number } | null;
  /** Pending and Hidden Posts reach only their poster and the Hosts. */
  status: "visible" | "pending" | "hidden";
  createdAt: number;
  /** Whether the viewer posted it. */
  mine: boolean;
  /** The Reactions it has, in the order they're offered (none with no count), and whether the viewer put each on. */
  reactions: { emoji: Emoji; count: number; mine: boolean }[];
}

/** What only the person looking is told about a Game; live updates go to everyone, so they never carry it. */
export type Viewer = Pick<GameView, "role" | "me" | "myVote">;
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
  if (demoPlayer !== undefined) {
    // The demo page's sample phone: every request says which made-up Player it is; the server checks it may be.
    const plain = fetchFn;
    fetchFn = (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("x-demo-player", demoPlayer);
      return plain(input, { ...init, headers });
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

    /** Who is signed in on this browser, if anyone. */
    async session(): Promise<Session | undefined> {
      if (demoPlayer !== undefined) return { email: "", feedbackOk: false, tipNoteRead: false, admin: false };
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
    async setGameOptions(gameId: string, options: { name?: string; turnSeconds?: number; rosterMode?: RosterMode }): Promise<SharedGame | undefined> {
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

    async adminFeedback(): Promise<FeedbackSummary | "notFound"> {
      const res = await fetchFn("/api/admin/feedback");
      if (res.status === 404) return "notFound";
      if (!res.ok) throw new Error(`loading the feedback failed: ${res.status}`);
      return (await res.json()) as FeedbackSummary;
    },

    /** Tells the statistics a Game used a feature only the browser sees, such as pasting the roster. */
    noteFeature(gameId: string, feature: "rosterPaste") {
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

    async createGame(settings: GameSettings, name?: string, rosterMode?: RosterMode, turnSeconds?: number, orgId?: string, demo = false): Promise<string> {
      const res = await postJson("/api/games", {
        settings,
        ...(name === undefined ? {} : { name }),
        ...(rosterMode ? { rosterMode } : {}),
        ...(turnSeconds === undefined ? {} : { turnSeconds }),
        ...(orgId ? { orgId } : {}),
        ...(demo ? { demo } : {}),
      });
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

    async addCohost(gameId: string, email: string): Promise<void> {
      const res = await postJson(`/api/games/${encodeURIComponent(gameId)}/cohosts`, { email });
      if (res.status !== 204) throw new Error(`adding a Co-host failed: ${res.status}`);
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
    watch(gameId: string, onGame: (game: SharedGame) => void, onMissing?: () => void, onPostsChanged?: () => void): () => void {
      const socketOptions = { auth: { gameId }, ...(options.transports ? { transports: options.transports } : {}) };
      const socket = options.socketOrigin ? io(options.socketOrigin, socketOptions) : io(socketOptions);
      socket.on("game", onGame);
      if (onPostsChanged) socket.on("posts", onPostsChanged);
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
      { photo, ...post }: { text: string; name?: string; giftId?: string; photo?: Blob },
    ): Promise<"posted" | "paused" | "notPhoto" | "tooBig" | "failed"> {
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
      if (res.status === 409) return "paused";
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
    async setPostStatus(gameId: string, postId: string, status: "visible" | "hidden"): Promise<boolean> {
      const res = await postJson(`/api/games/${encodeURIComponent(gameId)}/posts/${encodeURIComponent(postId)}/status`, { status });
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
