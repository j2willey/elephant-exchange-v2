import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { z } from "zod";
import { PHOTO_MAX_BYTES } from "./photos.js";

/** Reads and checks a JSON body; on failure, the 400 response to send instead. */
export async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  const raw: unknown = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, res: c.json({ error: "Invalid request", issues: parsed.error.issues }, 400) };
}

/** Words come as JSON; a Post or Theme image with a Photo comes as a multipart form: up to a Photo's size, and a little. */
export const photoSizeLimit = bodyLimit({
  maxSize: PHOTO_MAX_BYTES + 64 * 1024,
  onError: (c) => c.json({ error: "That Photo is too big to send" }, 413),
});
