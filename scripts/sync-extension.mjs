import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

for (const asset of ["codex-rtl-engine.js", "rtl-style.css", "action-board-core.js", "action-board.js", "action-board.css", "action-board-background.js"]) {
  copyFileSync(resolve(root, "src", asset), resolve(root, "extension", asset));
}

console.log("Synced shared Action Board assets into extension/.");
