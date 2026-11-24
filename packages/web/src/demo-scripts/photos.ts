/**
 * The Photos a guided demo posts. A script names each by key; its `file` is in `photos/` here, or
 * `asset:demo-gift-table` for the app's own demo photo. A picture not added yet is drawn as a placeholder card
 * showing its description, so a script can be written and played before its pictures exist (photos/PLACEHOLDERS.md).
 */
import giftTable from "../assets/demo-gift-table.webp";
import type { DemoScript } from "./format.js";

const files = import.meta.glob<string>("./photos/*.{jpg,jpeg,png,webp}", { eager: true, query: "?url", import: "default" });
const assets: Record<string, string> = { "asset:demo-gift-table": giftTable };

/** Where a photo's picture is, or undefined while it's still a placeholder. */
export function photoUrl(file: string): string | undefined {
  return assets[file] ?? files[`./photos/${file}`];
}

/** The photo as a file to post: the real picture, or a placeholder card drawn from its description. */
export async function photoBlob(script: DemoScript, key: string): Promise<Blob | undefined> {
  const photo = script.photos?.[key];
  if (!photo) return undefined;
  const url = photoUrl(photo.file);
  if (url) {
    const res = await fetch(url).catch(() => undefined);
    if (res?.ok) return res.blob();
  }
  return placeholder(photo.placeholder.replace(/^PLACEHOLDER:\s*/, ""), key);
}

/** Soft card colors, picked by the photo's key so each placeholder keeps its own. */
const CARDS = ["#f6e7c8", "#d9ecf2", "#e6dcf3", "#dcefdc", "#f6d9d9", "#f2e3d3"];

/** A 4:3 card with a 📷 and the description, as a JPEG. Undefined where there's no canvas (tests). */
async function placeholder(text: string, key: string): Promise<Blob | undefined> {
  if (typeof document === "undefined") return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 900;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  const hash = [...key].reduce((h, c) => h + c.charCodeAt(0), 0);
  ctx.fillStyle = CARDS[hash % CARDS.length]!;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#2b2b2b";
  ctx.textAlign = "center";
  ctx.font = "160px sans-serif";
  ctx.fillText("📷", canvas.width / 2, 300);
  ctx.font = "44px sans-serif";
  const lines = wrap(ctx, text, canvas.width - 200);
  lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, 440 + i * 60));
  ctx.font = "italic 32px sans-serif";
  ctx.fillStyle = "#6b6b6b";
  ctx.fillText("Picture coming soon", canvas.width / 2, canvas.height - 70);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? undefined), "image/jpeg", 0.85));
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const tried = line ? `${line} ${word}` : word;
    if (ctx.measureText(tried).width > width && line) {
      lines.push(line);
      line = word;
    } else line = tried;
  }
  if (line) lines.push(line);
  return lines.slice(0, 7);
}
