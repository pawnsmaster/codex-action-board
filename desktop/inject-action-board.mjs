import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import WebSocket from "ws";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = Number(portArg?.split("=")[1] || process.env.CODEX_ACTION_BOARD_PORT || process.env.CODEX_RTL_PORT || 9223);
const languageArg = process.argv.find((arg) => arg.startsWith("--language="));
const requestedLanguage = (languageArg?.split("=")[1] || process.env.CODEX_ACTION_BOARD_LANGUAGE || "").toLowerCase();
const languageOverride = requestedLanguage === "ar" || requestedLanguage === "en" ? requestedLanguage : "";

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("CODEX_ACTION_BOARD_PORT must be an integer between 1024 and 65535.");
}

const css = readFileSync(resolve(root, "src", "rtl-style.css"), "utf8");
const rtlEngine = readFileSync(resolve(root, "src", "codex-rtl-engine.js"), "utf8");
const actionBoardCss = readFileSync(resolve(root, "src", "action-board.css"), "utf8");
const actionBoardCore = readFileSync(resolve(root, "src", "action-board-core.js"), "utf8");
const actionBoard = readFileSync(resolve(root, "src", "action-board.js"), "utf8");

if (dryRun) {
  if (
    !css.includes("unicode-bidi") ||
    !rtlEngine.includes("MutationObserver") ||
    !actionBoardCss.includes(".codex-action-board") ||
    !actionBoardCore.includes("formatPrompt") ||
    !actionBoard.includes("insertIntoComposer")
  ) {
    throw new Error("Shared Action Board assets look incomplete.");
  }
  console.log("OK: RTL and Action Board assets are present.");
  process.exit(0);
}

const endpoint = `http://127.0.0.1:${port}/json`;

async function getTargets() {
  let response;
  try {
    response = await fetch(endpoint);
  } catch (error) {
    throw new Error(`Cannot reach ${endpoint}. Start Codex with desktop/Launch-CodexActionBoard.ps1 first.`);
  }
  if (!response.ok) {
    throw new Error(`DevTools endpoint returned HTTP ${response.status}.`);
  }
  return response.json();
}

function isLikelyCodexTarget(target) {
  const haystack = `${target.title || ""} ${target.url || ""}`.toLowerCase();
  return target.webSocketDebuggerUrl && (
    haystack.includes("codex") ||
    haystack.includes("chatgpt.com") ||
    haystack.includes("app://")
  );
}

function assertLocalDevToolsUrl(wsUrl) {
  const url = new URL(wsUrl);
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)) {
    throw new Error(`Refusing non-local DevTools target: ${url.hostname}`);
  }
}

function evaluate(wsUrl, expression) {
  assertLocalDevToolsUrl(wsUrl);
  return new Promise((resolvePromise, rejectPromise) => {
    const ws = new WebSocket(wsUrl);
    const id = 1;
    const timeout = setTimeout(() => {
      ws.close();
      rejectPromise(new Error("Timed out while injecting CSS."));
    }, 8000);

    ws.on("open", () => {
      ws.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: {
          expression,
          awaitPromise: false,
          returnByValue: true
        }
      }));
    });

    ws.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.id !== id) return;
      clearTimeout(timeout);
      ws.close();
      if (message.error || message.result?.exceptionDetails) {
        rejectPromise(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
      } else {
        resolvePromise(message.result);
      }
    });

    ws.on("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
  });
}

const targets = await getTargets();
const candidates = targets.filter(isLikelyCodexTarget);

if (candidates.length === 0) {
  throw new Error("No Codex-like renderer target found. Open a Codex conversation and try again.");
}

const expression = `
(() => {
  const languageOverride = ${JSON.stringify(languageOverride)};
  if (languageOverride) {
    try { localStorage.setItem("codex-action-board-language", languageOverride); } catch {}
    window.__CODEX_ACTION_BOARD_LANGUAGE__ = languageOverride;
  }
  window.__CODEX_RTL_STYLE__ = ${JSON.stringify(`${css}\n${actionBoardCss}`)};
  const sources = ${JSON.stringify([rtlEngine, actionBoardCore, actionBoard])};
  for (const source of sources) (0, eval)(source);
  const language = window.__CODEX_ACTION_BOARD_LANGUAGE__ || "en";
  const rtlStateMatchesLanguage = language === "ar" ? Boolean(window.__CODEX_RTL_ACTIVE__) : !window.__CODEX_RTL_ACTIVE__;
  return Boolean(window.__CODEX_ACTION_BOARD_ACTIVE__ && rtlStateMatchesLanguage);
})()
`;

for (const target of candidates) {
  await evaluate(target.webSocketDebuggerUrl, expression);
  console.log(`Injected RTL and Action Board into: ${target.title || target.url}`);
}
