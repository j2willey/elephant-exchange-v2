/** Every guided demo script, by id: each `scripts/<id>.json`. */
import type { DemoScript } from "./format.js";

const files = import.meta.glob<DemoScript>("./scripts/*.json", { eager: true, import: "default" });

export const SCRIPTS: Readonly<Record<string, DemoScript>> = Object.fromEntries(
  Object.entries(files).map(([path, script]) => [path.replace(/^.*\/(.*)\.json$/, "$1"), script]),
);
