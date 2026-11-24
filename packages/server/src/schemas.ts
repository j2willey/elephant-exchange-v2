import { z } from "zod";
import type { Command, GameOptions, GameSettings } from "@elephant/rules";

/** What comes over the wire is checked here, so the rules module only ever sees well-formed input. */

const id = z.string().min(1).max(64);
const name = z.string().trim().min(1).max(100);
/** A Gift's detail beyond its name; blank means none. */
const description = z.string().trim().max(300);
const activeSlots = z.int().min(1).max(10);
const maxSteals = z.int().min(0).max(20);

export const gameSettings = z.strictObject({ activeSlots, maxSteals }) satisfies z.ZodType<GameSettings>;

export const rosterMode = z.enum(["host", "self"]);

const turnSeconds = z.int().min(0).max(600);
const moderation = z.enum(["open", "approval", "paused"]);

/** A whole set of options, as a Host saves it to start every Game with. */
export const gameOptions = z.strictObject({
  activeSlots,
  maxSteals,
  turnSeconds,
  rosterMode,
  approveNames: z.boolean(),
  moderation,
}) satisfies z.ZodType<GameOptions>;

export const createGameBody = z.object({
  name: name.default("Gift exchange"),
  rosterMode: rosterMode.default("host"),
  turnSeconds: turnSeconds.default(60),
  approveNames: z.boolean().default(false),
  moderation: moderation.default("open"),
  settings: gameSettings,
  /** The Organization whose Theme it shows: one the Host is the Organizer of. */
  orgId: id.optional(),
  /** Made with "Try a demo game". */
  demo: z.boolean().default(false),
  /**
   * How the Host chose the options, for the statistics: the recommended ones, their own this time ("customized"), or
   * their saved ones. `looked`: they opened the full list of options, whatever they chose.
   */
  start: z.enum(["recommended", "customized", "saved"]).optional(),
  looked: z.boolean().default(false),
  /** "Always start with these settings": true saves this Game's options as theirs; false stops using saved ones. */
  remember: z.boolean().optional(),
});

/** A Theme color: "#rrggbb" only (it goes into the page's styles), kept lowercase. Null clears it. */
const themeColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((c) => c.toLowerCase())
  .nullable()
  .optional();

export const orgBody = z.object({ name });
export const orgEdit = z.object({ name: name.optional(), color: themeColor, page: themeColor });
export const gameOrgBody = z.object({ orgId: id.nullable() });
/** A Game's options besides its rules: each optional, so one can be changed at a time. */
export const gameOptionsEdit = z.object({
  name: name.optional(),
  tagline: z.string().trim().max(100).optional(),
  whenWhere: z.string().trim().max(120).optional(),
  turnSeconds: turnSeconds.optional(),
  rosterMode: rosterMode.optional(),
  approveNames: z.boolean().optional(),
  postsPerMinute: z.int().min(0).max(60).optional(),
  repitchMinutes: z.int().min(0).max(120).optional(),
});

export const gameThemeEdit = z.object({ color: themeColor, page: themeColor });

export const timerBody = z.object({ playerId: id });

export const postBody = z.object({
  /** May be empty when there's a Photo; a Post needs one or the other. */
  text: z.string().trim().max(500).default(""),
  /** A Guest's name to show; a Player's own name is used instead. */
  name: name.optional(),
  giftId: id.optional(),
  /** The Post this one replies to: a visible one in the same Game. */
  replyTo: id.optional(),
});

export const moderationBody = z.object({ mode: moderation });
/**
 * The Reactions anyone can put on a Post, in the order they're shown. Friendly ones only, to keep the Feed in good
 * spirits. Each is its emoji, except the leg lamp, which has no emoji: the web app draws its own icon for it.
 */
export const REACTIONS = ["👍", "❤️", "😂", "🎉", "🔥", "😮", "⛄", "leg-lamp"] as const;
/** Puts a Reaction on a Post (`on`) or takes it back. */
export const reactionBody = z.object({ emoji: z.enum(REACTIONS), on: z.boolean() });
/** Hides a Post (with every reply under it, if `thread`) or shows it again (with whatever was hidden with it). */
export const postStatusBody = z.object({ status: z.enum(["visible", "hidden"]), thread: z.boolean().optional() });
/** Says which Gift a Post is about, after posting; null for none. */
/** A part of a Gift's Pitch: empty text removes it. `playerId`: whose part (a Host writing for a holder). */
export const pitchBody = z.object({
  tagline: z.string().trim().max(80).default(""),
  text: z.string().trim().max(500).default(""),
  playerId: id.optional(),
  /** Takes the part's Photo off. */
  removePhoto: z.boolean().default(false),
});
/** "Pitch it again": whose part (a Host may send any holder's). */
export const repitchBody = z.object({ playerId: id.optional() });
export const postGiftBody = z.object({ giftId: z.string().min(1).max(64).nullable() });
/** Mutes or unmutes whoever wrote a Post; muting may hide all their Posts too, which unmuting brings back. */
export const muteBody = z.object({ postId: z.string().min(1).max(64), muted: z.boolean(), hidePosts: z.boolean().optional() });

export const joinBody = z.object({ name });
/** The Host or a Co-host renames someone, found by their Player or by one of their Posts, and locks the name or not. */
export const renameBody = z
  .object({ playerId: id.optional(), postId: id.optional(), key: id.optional(), name, locked: z.boolean() })
  .refine((b) => [b.playerId, b.postId, b.key].filter((x) => x !== undefined).length === 1, {
    message: "Say whose name: a playerId, a postId or a person's key",
  });
/** Approves the name someone asked for under Approve names; `key` is from the list of names waiting. */
export const approveNameBody = z.object({ key: id });

/**
 * A page of this app to return to after signing in: a path on this site only. "//host" and "/\\host" are
 * refused because browsers read them as another site, which would let a link send people anywhere.
 */
const returnPath = z.string().max(200).regex(/^\/(?![/\\])[\x21-\x7e]*$/);

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** `ref`: where they came from (?ref= on the link they followed), kept for the statistics if it's a plain word. */
export const linkRequest = z.object({ email, next: returnPath.optional(), feedbackOk: z.boolean().default(false), ref: z.string().max(64).optional() });
export const visitBody = z.object({ ref: z.string().max(64) });
export const excludeBody = z.object({ excluded: z.boolean() });
/** The features the browser reports itself (the server sees the rest); anything else sent is refused. */
export const featureBody = z.object({ feature: z.enum(["rosterPaste", "share"]) });
/** A Host's answer (stars, and maybe again and a comment) or a guest's (thumbs, and maybe a comment). */
export const answerBody = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  again: z.enum(["yes", "maybe", "no"]).optional(),
  thumbs: z.enum(["up", "down"]).optional(),
  comment: z.string().max(1000).optional(),
  /** "You may quote this on the website", with the name to show beside it ("Ann R., office manager"). */
  quoteOk: z.boolean().optional(),
  quoteName: z.string().trim().max(80).optional(),
});
export const publishBody = z.object({ published: z.boolean() });
export const suggestionBody = z.object({ comment: z.string().trim().min(1).max(2000) });
/**
 * A message from the contact form, from anyone: the words, an optional address for a reply, and `website`, a field
 * people never see (only bots fill it in).
 */
export const contactBody = z.object({
  message: z.string().trim().min(1).max(2000),
  replyTo: z.union([z.literal(""), z.email().max(254)]).optional(),
  website: z.string().max(500).optional(),
});
export const feedbackBody = z.object({ ok: z.boolean() });
export const linkRedemption = z.object({ token: z.string().min(1).max(100) });
/** Emails personal invitations: to these Players, or to everyone on the guest list not in or invited yet. */
export const invitationsBody = z.object({ playerIds: z.array(id).min(1).max(200).optional() });
/** A Co-host by email; `playsAs` links them to a Player the Host typed in, who hasn't signed in yet. */
export const cohostBody = z.object({ email, playsAs: id.optional() });
/** A Player's email on the guest list; null takes it off. */
export const playerEmailBody = z.object({ email: email.nullable() });
/** A Player added from the guest list, with their email. */
export const guestBody = z.object({ name, email });
/** From the Co-hosts panel: switch someone's Co-host role on or off, and/or say which Player they play as. */
export const personBody = z
  .object({ cohost: z.boolean().optional(), playsAs: id.nullable().optional() })
  .refine((b) => b.cohost !== undefined || b.playsAs !== undefined, "Say what to change");

export const command = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("AddPlayer"), playerId: id, name }),
  z.strictObject({ type: z.literal("StartGame") }),
  // The name may be left empty, to keep up with a fast party: it's then "Ann's gift" (by who opened it) until someone names it.
  z.strictObject({ type: z.literal("OpenGift"), playerId: id, giftId: id, name: z.string().trim().max(100), description: description.exactOptional() }),
  z.strictObject({ type: z.literal("Steal"), playerId: id, giftId: id }),
  z.strictObject({
    type: z.literal("ChangeSettings"),
    settings: z.strictObject({ activeSlots: activeSlots.exactOptional(), maxSteals: maxSteals.exactOptional() }),
  }),
  z.strictObject({ type: z.literal("Skip"), playerId: id }),
  z.strictObject({ type: z.literal("RemovePlayer"), playerId: id }),
  z.strictObject({ type: z.literal("Undo") }),
  z.strictObject({ type: z.literal("StartFinalRound"), finalists: z.int().min(0).max(200), leftoverGifts: z.int().min(0).max(200) }),
  z.strictObject({ type: z.literal("KeepGift"), playerId: id }),
  z.strictObject({ type: z.literal("TakeReturnedGift"), playerId: id, giftId: id }),
  z.strictObject({ type: z.literal("EndGame") }),
  z.strictObject({ type: z.literal("DescribeGift"), giftId: id, name, description }),
]) satisfies z.ZodType<Command>;

export const voteStatusBody = z.object({
  status: z.enum(["open", "closed"]),
  /** When closing with Gifts tied for most votes: the one the Host picks. */
  winner: id.optional(),
});
/** What the big screen shows. */
export const screenModeBody = z.object({ mode: z.enum(["gifts", "rules", "qr", "catalog", "highlights"]) });
export const voteDisplayBody = z.object({ display: z.enum(["live", "hidden", "parade"]) });
export const voteBody = z.object({ giftId: id });
