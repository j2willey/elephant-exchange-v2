import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

// Each Photo is read once, so sharp's cache of recent inputs would only hold memory (scarce on a small droplet).
sharp.cache(false);

/** The longest side a stored Photo may have: plenty for a phone or the big screen. */
export const PHOTO_MAX_SIDE = 1600;
/** Photos are deleted this long after their Game's last move (see CONTEXT.md: Photo). */
export const PHOTO_KEEP_DAYS = 60;
/** The most a Photo upload may weigh. Phones shrink Photos before sending, so this is only for when they can't. */
export const PHOTO_MAX_BYTES = 12 * 1024 * 1024;

export interface StoredPhoto {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * Makes the Photo that's kept from whatever was sent: turned upright, shrunk to fit PHOTO_MAX_SIDE, and
 * re-encoded as JPEG. Re-encoding keeps none of the original's metadata, so EXIF (where it was taken, the
 * camera, sometimes a name) is gone. Undefined if it isn't an image sharp can read.
 */
export async function preparePhoto(input: Uint8Array): Promise<StoredPhoto | undefined> {
  try {
    const { data, info } = await sharp(input, { limitInputPixels: 100_000_000, failOn: "error" })
      .rotate() // by the EXIF orientation, before it's dropped
      .resize({ width: PHOTO_MAX_SIDE, height: PHOTO_MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    return undefined;
  }
}

/** Where Photos live on disk: one folder per Game, one file per Post. Ids are ours (never taken from a request unchecked). */
export function photoStore(dir: string) {
  const file = (gameId: string, postId: string) => join(dir, gameId, `${postId}.jpg`);
  return {
    save(gameId: string, postId: string, data: Buffer) {
      mkdirSync(join(dir, gameId), { recursive: true });
      const path = file(gameId, postId);
      writeFileSync(`${path}.partial`, data);
      renameSync(`${path}.partial`, path);
    },
    read: (gameId: string, postId: string): Buffer | undefined => {
      try {
        return readFileSync(file(gameId, postId));
      } catch {
        return undefined;
      }
    },
    remove: (gameId: string, postId: string) => rmSync(file(gameId, postId), { force: true }),
    removeGame: (gameId: string) => rmSync(join(dir, gameId), { recursive: true, force: true }),
    /** All the Photos kept, in bytes. */
    bytes: () => {
      let total = 0;
      for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
        if (entry.isFile()) total += statSync(join(entry.parentPath, entry.name)).size;
      }
      return total;
    },
  };
}

export type ThemeImage = "logo" | "background";
export const isThemeImage = (kind: string): kind is ThemeImage => kind === "logo" || kind === "background";

/**
 * A Theme's logo or background as kept: turned upright, shrunk (a logo to fit 600px, a background 2400px) and
 * re-encoded as WebP, which keeps a logo's transparency and drops all metadata. Undefined if it isn't an image.
 */
export async function prepareThemeImage(input: Uint8Array, kind: ThemeImage): Promise<Buffer | undefined> {
  const side = kind === "logo" ? 600 : 2400;
  try {
    return await sharp(input, { limitInputPixels: 100_000_000, failOn: "error" })
      .rotate()
      .resize({ width: side, height: side, fit: "inside", withoutEnlargement: true })
      .webp(kind === "logo" ? { quality: 90, alphaQuality: 100 } : { quality: 80 })
      .toBuffer();
  } catch {
    return undefined;
  }
}

/** Where Theme images live: one folder per Organization ("org-<id>") or Game ("game-<id>"), one file per kind. */
export function themeStore(dir: string) {
  const file = (owner: string, kind: ThemeImage) => join(dir, owner, `${kind}.webp`);
  return {
    save(owner: string, kind: ThemeImage, data: Buffer) {
      mkdirSync(join(dir, owner), { recursive: true });
      const path = file(owner, kind);
      writeFileSync(`${path}.partial`, data);
      renameSync(`${path}.partial`, path);
    },
    read: (owner: string, kind: ThemeImage): Buffer | undefined => {
      try {
        return readFileSync(file(owner, kind));
      } catch {
        return undefined;
      }
    },
    remove: (owner: string, kind: ThemeImage) => rmSync(file(owner, kind), { force: true }),
  };
}
