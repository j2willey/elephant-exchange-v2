import { z } from "zod";
import type { Command, GameSettings } from "@elephant/rules";

/** What comes over the wire is checked here, so the rules module only ever sees well-formed input. */

const id = z.string().min(1).max(64);
const name = z.string().trim().min(1).max(100);
const activeSlots = z.int().min(1).max(10);
const maxSteals = z.int().min(0).max(20);

export const gameSettings = z.strictObject({ activeSlots, maxSteals }) satisfies z.ZodType<GameSettings>;

export const createGameBody = z.object({ settings: gameSettings });

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const linkRequest = z.object({ email });
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
