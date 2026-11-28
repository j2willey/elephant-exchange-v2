/**
 * What the server sends, as the browser receives it: one name for each response, for the web app to import
 * (type-only) instead of keeping its own copy (ADR 0002).
 *
 * Where a module-level function builds a response, its type is taken from that function, so it can't drift from
 * what's sent. Responses built inside a route are described here, and the route checks what it sends against the
 * description with `satisfies`.
 */
import type { GameOptions, Phase } from "@elephant/rules";
import type { JSONParsed } from "hono/utils/types";
import type { Role } from "./access.js";
import type { FeedbackSummary as FeedbackSummaryRow, Testimonial as TestimonialRow } from "./feedback.js";
import type { Feed } from "./feed.js";
import type { LoadedGame } from "./game-store.js";
import type { REACTIONS } from "./schemas.js";
import type { view } from "./server.js";
import type { GameRecord as GameRecordRow, RecordKind, StatsSummary as StatsSummaryRow } from "./stats.js";
import type { ServerHealth as ServerHealthRow } from "./system.js";

/** A value as it arrives once sent as JSON (a Date as its string, and so on). */
export type Json<T> = JSONParsed<T>;

/** A Game as every screen watching it is shown it: the same for everyone (see view()). */
export type SharedGame = Json<ReturnType<typeof view>>;
/** How the Game looks: its Organization's Theme with the Game's own overrides; null parts use the app's look. */
export type Theme = SharedGame["theme"];

/** What only the person looking is told about a Game; live updates go to everyone, so they never carry it. */
export interface Viewer {
  /** Whether the person looking runs this Game. */
  role: Role | null;
  /** The Player the person looking signed up as, if they did. */
  me: { playerId: string } | null;
  /**
   * The name the person looking goes by here (a Player's, or the one a Guest posts as; null until they give one), and
   * whether the Host or a Co-host has locked it. Null when nobody is signed in.
   */
  myName: { name: string | null; locked: boolean; pending: string | null } | null;
  /** Whether the Host or a Co-host has muted the person looking: they can't post or reply here. */
  muted: boolean;
  /** For a mute for a while: the seconds until they may post again. Null when not muted, or muted until unmuted. */
  mutedSeconds: number | null;
  /** The Gift the person looking voted the worst, if they have. */
  myVote: string | null;
  /** In a Host-entered Game: they've asked the Host to add them as a Player, and are waiting. */
  asking: boolean;
}

/** For the Host and Co-hosts: someone asking to be added as a Player, by the name they gave. */
export interface AskingToPlay {
  key: string;
  name: string;
}
/** A Game as the person looking is shown it. */
export type GameView = SharedGame & Viewer;

export type VoteStatus = LoadedGame["vote"]["status"];
export type VoteDisplay = LoadedGame["vote"]["display"];
export type ScreenMode = LoadedGame["screen"];
export type RosterMode = LoadedGame["rosterMode"];
export type Moderation = LoadedGame["moderation"];

/** A Reaction, by what the server knows it as: the emoji itself, or for the leg lamp (which has none) a name. */
export type Emoji = (typeof REACTIONS)[number];
/** A Post in the Feed, as this viewer may see it (see the Feed's list). */
export type Post = Json<ReturnType<Feed["list"]>[number]>;
/** The Post a reply answers, as shown above the reply; or just `removed` once the viewer can no longer see it. */
export type Quote = NonNullable<Post["replyTo"]>;

/** Who's signed in. */
export interface Session {
  email: string;
  feedbackOk: boolean;
  /** Whether they've read and considered Jim's tip note (New Game shows it until then). */
  tipNoteRead: boolean;
  /** Whether they may use the admin pages. */
  admin: boolean;
  /** Trying the demo without signing in: demo Games only, until they sign in with their email. */
  visitor: boolean;
  /** Their own Game options, saved with "Always start with these settings" (null if never saved). */
  myOptions: GameOptions | null;
  /** New Game uses `myOptions` straight away. */
  alwaysMyOptions: boolean;
}

/** One of the Games a person runs, as listed on their home screen. */
export interface MyGame {
  id: string;
  name: string;
  phase: Phase;
  players: number;
  role: Role;
}

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
  role: Role | null;
  /** Whether this is the Host looking. */
  you: boolean;
}

/** A Player who is also the Host or a Co-host, marked on their consoles. */
/** For the Host and Co-hosts only: a Player's email on the guest list, and whether they've opened the Game signed in. */
export interface GuestListEntry {
  playerId: string;
  email: string;
  joined: boolean;
  /** When they were last emailed a personal invitation (ms since 1970); null if never. */
  invitedAt: number | null;
}

export interface StaffMember {
  playerId: string;
  role: Role;
}

/** A name someone asked for under Approve names: `shown` is what everyone sees meanwhile. */
export interface PendingName {
  key: string;
  shown: string;
  wants: string;
  playerId: string | null;
}

/** An Organization the signed-in person is the Organizer of, with its Theme. */
export interface MyOrg {
  id: string;
  name: string;
  /** Colors as "#rrggbb". */
  color: string | null;
  page: string | null;
  logoUrl: string | null;
  backgroundUrl: string | null;
}

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

/** Someone who has signed in, for the admin's People page. */
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

/** A Game, for the admin's Games page. */
export interface AdminGame {
  id: string;
  name: string;
  demo: boolean;
  host: string;
  phase: Phase;
  players: number;
  createdAt: string;
}

/** How one server is doing, with what's wrong in words; for the admin's System page. */
export type ServerHealth = Json<ServerHealthRow & { warnings: string[] }>;
/** Every server's health, as checked at `checkedAt`. */
export interface SystemReport {
  checkedAt: string;
  servers: ServerHealth[];
}

/** The usage statistics (ADR-0005), as the admin's Stats page shows them. */
export type StatsSummary = Json<StatsSummaryRow>;
export type StatsInsights = StatsSummary["insights"];
export type GameRecord = Json<GameRecordRow>;
export type { RecordKind };

/** What Hosts and guests said, for the admin. */
export type FeedbackSummary = Json<FeedbackSummaryRow>;
/** Someone's own words on the front page, published by Jim with their OK. */
export type Testimonial = Json<TestimonialRow>;
