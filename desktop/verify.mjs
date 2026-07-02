import WebSocket from "ws";

const port = Number(process.env.CODEX_RTL_PORT || 9223);
const smoke = process.argv.includes("--smoke");
const endpoint = `http://127.0.0.1:${port}/json`;
const response = await fetch(endpoint);
if (!response.ok) throw new Error(`DevTools endpoint returned HTTP ${response.status}.`);

const targets = (await response.json()).filter((target) => {
  const haystack = `${target.title || ""} ${target.url || ""}`.toLowerCase();
  return target.webSocketDebuggerUrl && (haystack.includes("codex") || haystack.includes("app://"));
});

if (!targets.length) throw new Error("No Codex renderer target found.");

function inspect(wsUrl) {
  const parsed = new URL(wsUrl);
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname)) {
    throw new Error(`Refusing non-local DevTools target: ${parsed.hostname}`);
  }
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => { ws.close(); reject(new Error("Verification timed out.")); }, 5000);
    ws.on("open", () => ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `JSON.stringify({
          rtlActive: Boolean(window.__CODEX_RTL_ACTIVE__),
          actionBoardActive: Boolean(window.__CODEX_ACTION_BOARD_ACTIVE__),
          responseTriggers: document.querySelectorAll('.codex-action-trigger').length,
          panelPresent: Boolean(document.querySelector('.codex-action-board')),
          contextActionBridge: typeof window.__CODEX_ACTION_BOARD_OPEN_CONTEXT__ === 'function',
          smoke: ${smoke ? `(() => {
            const trigger = document.querySelector('.codex-action-trigger');
            if (!trigger) return { attempted: false };
            trigger.click();
            const panel = document.querySelector('.codex-action-board');
            const rect = panel?.getBoundingClientRect();
            const firstField = panel?.querySelector('textarea');
            const firstItem = panel?.querySelector('.codex-action-item');
            const itemNumber = firstItem?.querySelector('.codex-action-item__number')?.getBoundingClientRect();
            const itemMoves = firstItem?.querySelector('.codex-action-item__moves')?.getBoundingClientRect();
            const result = {
              attempted: true,
              panelOpened: Boolean(panel && !panel.hidden),
              extractedItems: panel?.querySelectorAll('.codex-action-item').length || 0,
              insertDisabled: Boolean(panel?.querySelector('.codex-action-board__insert')?.disabled),
              mode: panel?.dataset.mode,
              placement: panel?.dataset.placement,
              rect: rect ? { top: rect.top, left: rect.left, right: rect.right, width: rect.width } : null,
              overflowingTextareas: Array.from(panel?.querySelectorAll('textarea') || []).filter((field) => field.scrollWidth > field.clientWidth + 1).length,
              rtlLayout: panel && firstItem ? {
                panelDirAttribute: panel.getAttribute('dir'),
                panel: getComputedStyle(panel).direction,
                bulk: getComputedStyle(panel.querySelector('.codex-action-board__bulk')).direction,
                item: getComputedStyle(firstItem).direction,
                itemTop: getComputedStyle(firstItem.querySelector('.codex-action-item__top')).direction,
                statuses: getComputedStyle(firstItem.querySelector('.codex-action-item__statuses')).direction,
                numberX: itemNumber?.x,
                movesX: itemMoves?.x,
                headingAlign: getComputedStyle(panel.querySelector('h2')).textAlign,
                fieldLabelAlign: getComputedStyle(firstItem.querySelector('.codex-action-item__label')).textAlign,
                previewDirection: getComputedStyle(panel.querySelector('.codex-action-board__preview pre')).direction,
                previewAlign: getComputedStyle(panel.querySelector('.codex-action-board__preview pre')).textAlign,
                previewSummaryAlign: getComputedStyle(panel.querySelector('.codex-action-board__preview summary')).textAlign,
                insertDirection: getComputedStyle(panel.querySelector('.codex-action-board__insert')).direction,
                insertAlign: getComputedStyle(panel.querySelector('.codex-action-board__insert')).textAlign
              } : null,
              colors: panel && firstField ? {
                panelForeground: getComputedStyle(panel).color,
                panelBackground: getComputedStyle(panel).backgroundColor,
                secondaryForeground: getComputedStyle(panel.querySelector('.codex-action-board__summary')).color,
                fieldForeground: getComputedStyle(firstField).color,
                fieldBackground: getComputedStyle(firstField).backgroundColor,
                placeholder: getComputedStyle(firstField, '::placeholder').color
              } : null
            };
            panel?.querySelector('.codex-action-board__close')?.click();
            result.panelClosed = Boolean(panel?.hidden);
            return result;
          })()` : "null"},
          diagnostics: {
            styleHasPanelRtl: (document.getElementById('codex-rtl-toolkit-style')?.textContent || '').includes('direction: rtl !important'),
            styleLength: document.getElementById('codex-rtl-toolkit-style')?.textContent?.length || 0,
            pendingStyleHasPanelRtl: String(window.__CODEX_RTL_STYLE__ || '').includes('direction: rtl !important'),
            articles: document.querySelectorAll('article').length,
            mains: document.querySelectorAll('main').length,
            iframes: document.querySelectorAll('iframe, webview').length,
            desktopMarker: Boolean(document.querySelector('[class*="electron:"]')),
            assistantRoles: document.querySelectorAll('[data-message-author-role="assistant" i]').length,
            discoveredResponses: document.querySelectorAll('[data-codex-assistant-response="true"]').length
          }
        })`,
        returnByValue: true
      }
    })));
    ws.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.id !== 1) return;
      clearTimeout(timeout);
      ws.close();
      if (message.error || message.result?.exceptionDetails) reject(new Error("Renderer verification failed."));
      else resolve(JSON.parse(message.result.result.value));
    });
    ws.on("error", reject);
  });
}

let verified = 0;
for (const target of targets) {
  const result = await inspect(target.webSocketDebuggerUrl);
  if (!result.rtlActive || !result.actionBoardActive || !result.panelPresent || !result.contextActionBridge) {
    throw new Error(`Incomplete injection in ${target.title || target.url}: ${JSON.stringify(result)}`);
  }
  if (target.title === "Codex" && result.diagnostics.mains > 0 && result.responseTriggers === 0) {
    throw new Error(`No response triggers were attached in the live Codex renderer: ${JSON.stringify(result.diagnostics)}`);
  }
  if (smoke && result.diagnostics.mains > 0 && result.responseTriggers > 0 && (
    !result.smoke?.attempted || !result.smoke.panelOpened || !result.smoke.panelClosed || result.smoke.extractedItems < 1
  )) {
    throw new Error(`Live Action Board smoke test failed: ${JSON.stringify(result.smoke)}`);
  }
  if (smoke && result.diagnostics.mains > 0 && result.diagnostics.desktopMarker && (
    !["docked", "sidepanel"].includes(result.smoke.mode)
      || result.smoke.rect?.top < 30
      || result.smoke.overflowingTextareas > 0
      || result.smoke.rtlLayout?.panel !== "rtl"
      || result.smoke.rtlLayout?.bulk !== "rtl"
      || result.smoke.rtlLayout?.itemTop !== "rtl"
      || result.smoke.rtlLayout?.statuses !== "rtl"
      || result.smoke.rtlLayout?.numberX <= result.smoke.rtlLayout?.movesX
      || result.smoke.rtlLayout?.headingAlign !== "right"
      || result.smoke.rtlLayout?.fieldLabelAlign !== "right"
      || result.smoke.rtlLayout?.previewDirection !== "rtl"
      || result.smoke.rtlLayout?.previewAlign !== "right"
      || result.smoke.rtlLayout?.previewSummaryAlign !== "right"
      || result.smoke.rtlLayout?.insertDirection !== "rtl"
      || result.smoke.rtlLayout?.insertAlign !== "center"
  )) {
    throw new Error(`Live panel placement or wrapping check failed: ${JSON.stringify(result.smoke)}`);
  }
  verified += 1;
  console.log(JSON.stringify({ target: target.title || target.url, ...result }));
}

console.log(`Verified ${verified} live Codex renderer target(s).`);
