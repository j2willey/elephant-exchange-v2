import { z } from "zod";
import type { Command, GameSettings } from "@elephant/rules";

/** What comes over the wire is checked here, so the rules module only ever sees well-formed input. */

const id = z.string().min(1).max(64);
const name = z.string().trim().min(1).max(100);
const activeSlots = z.int().min(1).max(10);
const maxSteals = z.int().min(0).max(20);

export const gameSettings = z.strictObject({ activeSlots, maxSteals }) satisfies z.ZodType<GameSettings>;

export const rosterMode = z.enum(["host", "self"]);

export const createGameBody = z.object({
  name: name.default("Gift exchange"),
  rosterMode: rosterMode.default("host"),
  turnSeconds: z.int().min(0).max(600).default(60),
  settings: gameSettings,
});

export const timerBody = z.object({ playerId: id });

export const postBody = z.object({
  text: z.string().trim().min(1).max(500),
  /** A Guest's name to show; a Player's own name is used instead. */
  name: name.optional(),
  giftId: id.optional(),
});

export const moderationBody = z.object({ mode: z.enum(["open", "approval", "paused"]) });
export const postStatusBody = z.object({ status: z.enum(["visible", "hidden"]) });

export const joinBody = z.object({ name });

/**
 * A page of this app to return to after signing in: a path on this site only. "//host" and "/\\host" are
 * refused because browsers read them as another site, which would let a link send people anywhere.
 */
const returnPath = z.string().max(200).regex(/^\/(?![/\\])[\x21-\x7e]*$/);

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const linkRequest = z.object({ email, next: returnPath.optional() });
export const linkRedemption = z.object({ token: z.string().min(1).max(100) });
export const cohostBody = z.object({ email });

export const command = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("AddPlayer"), playerId: id, name }),
  z.strictObject({ type: z.literal("StartGame") }),
  z.strictObject({ type: z.literal("OpenGift"), playerId: id, giftId: id, name }),
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
]) satisfies z.ZodType<Command>;
