import { afterEach, describe, expect, it, vi } from "vitest";
import { PHOTO_TARGET_BYTES, PhotoTooBig, shrinkPhoto } from "../src/shrinkPhoto.js";

/**
 * jsdom can't decode or draw images, so the phone's browser is stood in for: a decoded photo of the given size, and
 * a JPEG encoder whose output grows with the pixels and the quality, roughly as a real one does for a party photo.
 */
function phoneBrowser(width: number, height: number) {
  const encoded: { width: number; height: number; quality: number }[] = [];
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width, height, close() {} })));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage() {} } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, done, type, quality) {
    encoded.push({ width: this.width, height: this.height, quality: quality as number });
    done(new Blob([new Uint8Array(Math.round(this.width * this.height * (quality as number) * 0.25))], { type: type ?? "image/png" }));
  });
  return encoded;
}
const camera = (bytes: number) => new File([new Uint8Array(bytes)], "IMG_0001.jpg", { type: "image/jpeg" });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Shrinking a Photo on the phone", () => {
  it("brings a full-size camera shot under 200 KB, at most 1280 px on its long side, turned upright", async () => {
    const encoded = phoneBrowser(4032, 3024);

    const sent = await shrinkPhoto(camera(4_800_000));

    expect(sent.size).toBeLessThanOrEqual(PHOTO_TARGET_BYTES);
    expect(sent.type).toBe("image/jpeg");
    expect(Math.max(encoded.at(-1)!.width, encoded.at(-1)!.height)).toBeLessThanOrEqual(1280);
    expect(createImageBitmap).toHaveBeenCalledWith(expect.anything(), { imageOrientation: "from-image" });
    // The best quality that fits: it stepped down only as far as it had to.
    expect(encoded.map((e) => e.quality)).toEqual([0.8, 0.7, 0.6]);
  });

  it("re-encodes even a small photo, so its location and camera details never leave the phone", async () => {
    const encoded = phoneBrowser(800, 600);
    const small = camera(150_000);

    const sent = await shrinkPhoto(small);

    expect(sent).not.toBe(small);
    expect(encoded).toHaveLength(1);
  });

  it("gets a huge panorama under 200 KB too, by making it smaller still", async () => {
    phoneBrowser(12000, 3000);
    expect((await shrinkPhoto(camera(9_000_000))).size).toBeLessThanOrEqual(PHOTO_TARGET_BYTES);
  });

  it("won't send a big photo the phone can't shrink; a small one goes as it is, for the server to clean", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => Promise.reject(new Error("can't decode"))));

    await expect(shrinkPhoto(camera(3_000_000))).rejects.toBeInstanceOf(PhotoTooBig);
    const small = camera(90_000);
    expect(await shrinkPhoto(small)).toBe(small);
  });
});
