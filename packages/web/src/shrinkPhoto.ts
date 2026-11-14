/** The longest side worth sending: the server keeps Photos at most this big anyway. */
const MAX_SIDE = 1600;

/**
 * Shrinks a Photo on the phone before it's sent, so a 5 MB camera shot goes up as a few hundred KB over the
 * party's Wi-Fi. Turned upright first (from its EXIF). If the browser can't (or it's small already), the
 * original is sent and the server shrinks it instead. Either way the server re-encodes it, stripping EXIF.
 */
export async function shrinkPhoto(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const shrunk = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.85));
    return shrunk ?? file;
  } catch {
    return file; // such as a format this browser can't draw: the server may still manage it
  }
}
