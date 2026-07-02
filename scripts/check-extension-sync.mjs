import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const pairs = [
  ["src/injected.js", "extension/injected.js"],
  ["src/rtl-style.css", "extension/rtl-style.css"],
  ["src/action-board-core.js", "extension/action-board-core.js"],
  ["src/action-board.js", "extension/action-board.js"],
  ["src/action-board.css", "extension/action-board.css"],
  ["src/background.js", "extension/background.js"]
];

for (const [source, copy] of pairs) {
  const sourceText = readFileSync(resolve(root, source), "utf8");
  const copyText = readFileSync(resolve(root, copy), "utf8");
  if (sourceText !== copyText) {
    throw new Error(`${copy} is out of sync with ${source}. Run npm run build:extension.`);
  }
}

console.log("OK: extension assets are synced.");
