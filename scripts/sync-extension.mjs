import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

for (const asset of ["injected.js", "rtl-style.css", "action-board-core.js", "action-board.js", "action-board.css", "background.js"]) {
  copyFileSync(resolve(root, "src", asset), resolve(root, "extension", asset));
}

console.log("Synced shared RTL and Action Board assets into extension/.");
