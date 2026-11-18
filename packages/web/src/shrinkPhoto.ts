/** What a Feed Photo is brought under on the phone: plenty for a phone screen or the TV, quick over party Wi-Fi. */
export const PHOTO_TARGET_BYTES = 200_000;

/**
 * Tried in order until the JPEG fits: the best quality first, then lower quality, then fewer pixels. The last is
 * far under the target for any real photo; if one were still over, that smallest version is sent.
 */
const STEPS: readonly (readonly [longSide: number, quality: number])[] = [
  [1280, 0.8],
  [1280, 0.7],
  [1280, 0.6],
  [1024, 0.6],
  [800, 0.5],
];

/** A photo the phone couldn't shrink, and too big to send as it is. */
export class PhotoTooBig extends Error {
  constructor() {
    super("This photo couldn't be made smaller on this phone");
  }
}

/**
 * Shrinks a Photo on the phone before it's sent: phones take 3–12 MB shots by default, and nobody changes the
 * setting. Turned upright first (from its EXIF), then always re-encoded, even when small, so its location and
 * camera details never leave the phone. If this browser can't decode it, a photo already under the target goes as
 * it is (the server re-encodes it, stripping EXIF); a bigger one is refused rather than sent full size.
 */
export async function shrinkPhoto(file: Blob): Promise<Blob> {
  const bitmap = typeof createImageBitmap === "function" ? await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null) : null;
  if (!bitmap) return asItIs(file);
  try {
    let smallest: Blob | null = null;
    for (const [longSide, quality] of STEPS) {
      const jpeg = await encode(bitmap, longSide, quality);
      if (!jpeg) break; // this browser can't encode a JPEG
      smallest = jpeg;
      if (jpeg.size <= PHOTO_TARGET_BYTES) return jpeg;
    }
    return smallest ?? asItIs(file);
  } finally {
    bitmap.close();
  }
}

function asItIs(file: Blob): Blob {
  if (file.size <= PHOTO_TARGET_BYTES) return file;
  throw new PhotoTooBig();
}

async function encode(bitmap: ImageBitmap, longSide: number, quality: number): Promise<Blob | null> {
  const scale = Math.min(1, longSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((done) => canvas.toBlob(done, "image/jpeg", quality));
}
