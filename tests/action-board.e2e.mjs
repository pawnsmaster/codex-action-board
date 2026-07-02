import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const playwrightPath = process.env.CODEX_PLAYWRIGHT_PATH || "playwright";
const { chromium } = await import(playwrightPath);
const root = normalize(fileURLToPath(new URL("..", import.meta.url)));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

function luminance(color) {
  const scale = color.startsWith("color(srgb") ? 1 : 255;
  const channels = color.match(/[\d.]+/g).slice(0, 3).map((value) => Number(value) / scale)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first, second) {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const relativePath = pathname === "/" ? "tests/fixture.html" : pathname.replace(/^\/+/, "");
    const file = join(root, relativePath);
    if (!file.startsWith(root)) throw new Error("Invalid path");
    const content = await readFile(file);
    response.writeHead(200, { "content-type": `${types[extname(file)] || "text/plain"}; charset=utf-8` });
    response.end(content);
  } catch {
    if (!response.headersSent) response.writeHead(404);
    response.end("Not found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://127.0.0.1:${port}/tests/fixture.html`);

  assert.equal(await page.locator(".codex-action-trigger").count(), 1, "response trigger should be injected");
  assert.equal(await page.locator(".codex-action-side-panel-entry").count(), 1, "native side panel should receive an Action Board entry");
  assert.equal(await page.locator(".codex-action-selection-trigger").count(), 1, "selection floating trigger should be injected once");
  assert.equal(await page.locator(".codex-action-selection-trigger").isHidden(), true, "selection floating trigger should start hidden");
  await page.evaluate(async () => {
    const source = await (await fetch("../src/action-board.js")).text();
    (0, eval)(source);
  });
  assert.equal(await page.locator(".codex-action-trigger").count(), 1, "reinjection should not duplicate response triggers");
  assert.equal(await page.locator(".codex-action-side-panel-entry").count(), 1, "reinjection should not duplicate side panel entries");
  assert.equal(await page.locator(".codex-action-selection-trigger").count(), 1, "reinjection should not duplicate selection triggers");
  const sidePanelTypography = await page.evaluate(() => {
    const action = document.querySelector(".codex-action-side-panel-entry");
    const sideChat = Array.from(document.querySelectorAll(".native-side-panel button")).find((button) => button.textContent.includes("Side chat"));
    const actionShortcut = Array.from(action.querySelectorAll("*")).find((node) => node.textContent.includes("Ctrl"));
    const sideChatShortcut = Array.from(sideChat.querySelectorAll("*")).find((node) => node.textContent.includes("Ctrl"));
    const actionIcon = action.querySelector("svg")?.innerHTML || action.querySelector(".codex-action-side-panel-entry__icon")?.textContent || "";
    const selectionIcon = document.querySelector(".codex-action-selection-trigger svg")?.innerHTML || "";
    const actionSvg = action.querySelector("svg");
    const sideChatIcon = sideChat.querySelector("svg")?.innerHTML || sideChat.querySelector(".codex-action-side-panel-entry__icon")?.textContent || "";
    return {
      actionFont: getComputedStyle(action).fontSize,
      sideChatFont: getComputedStyle(sideChat).fontSize,
      actionShortcut: action.textContent,
      actionShortcutFont: actionShortcut ? getComputedStyle(actionShortcut).fontSize : "",
      sideChatShortcutFont: sideChatShortcut ? getComputedStyle(sideChatShortcut).fontSize : "",
      actionIcon,
      selectionIcon,
      actionIconViewBox: actionSvg?.getAttribute("viewBox") || "",
      actionIconFill: actionSvg?.getAttribute("fill") || "",
      actionIconStroke: actionSvg?.getAttribute("stroke") || "",
      actionIconStrokeWidth: actionSvg?.getAttribute("stroke-width") || "",
      actionIconClass: actionSvg?.classList.contains("codex-action-side-panel-entry__icon") || false,
      sideChatIcon
    };
  });
  assert.equal(sidePanelTypography.actionFont, sidePanelTypography.sideChatFont, "Action Board side panel entry should match native option font size");
  assert.match(sidePanelTypography.actionShortcut, /Ctrl\+Alt\+L/, "Action Board side panel entry should show its keyboard shortcut");
  assert.equal(sidePanelTypography.actionShortcutFont, sidePanelTypography.sideChatShortcutFont, "Action Board shortcut should match native shortcut font size");
  assert.equal(sidePanelTypography.actionIcon, sidePanelTypography.selectionIcon, "Action Board side panel entry should reuse the selection trigger icon");
  assert.equal(sidePanelTypography.actionIconViewBox, "0 0 24 24", "Action Board side panel icon should use the same viewBox as the floating trigger");
  assert.equal(sidePanelTypography.actionIconFill, "none", "Action Board side panel icon should not inherit fill from the cloned native icon");
  assert.equal(sidePanelTypography.actionIconStroke, "currentColor", "Action Board side panel icon should use stroked line art");
  assert.equal(sidePanelTypography.actionIconStrokeWidth, "1.75", "Action Board side panel icon should match the floating trigger stroke width");
  assert.equal(sidePanelTypography.actionIconClass, true, "Action Board side panel icon should receive the Action Board icon class");
  assert.notEqual(sidePanelTypography.actionIcon, sidePanelTypography.sideChatIcon, "Action Board side panel entry should have a distinct icon");
  assert.equal(await page.locator(".codex-action-board").count(), 1, "reinjection should replace the existing panel");
  await page.locator(".codex-action-trigger").click();
  await page.locator(".codex-action-board").waitFor({ state: "visible" });
  await page.waitForTimeout(220);
  const desktopBox = await page.locator(".codex-action-board").boundingBox();
  assert.ok(desktopBox.x >= 850, "desktop panel should dock after the conversation surface");
  assert.equal(await page.locator(".codex-action-board").getAttribute("data-mode"), "sidepanel");
  const nativeSidePanelBox = await page.locator(".native-side-panel").boundingBox();
  assert.ok(Math.abs(desktopBox.width - nativeSidePanelBox.width) <= 1, "Action Board should use the current native side panel width");
  const closeBox = await page.locator(".codex-action-board__close").boundingBox();
  assert.ok(closeBox.x + closeBox.width / 2 < desktopBox.x + desktopBox.width / 2, "panel close button should stay on the inner side away from the app window close button");
  const rtlLayout = await page.evaluate(() => {
    const panel = document.querySelector(".codex-action-board");
    const item = panel.querySelector(".codex-action-item");
    const number = item.querySelector(".codex-action-item__number").getBoundingClientRect();
    const moves = item.querySelector(".codex-action-item__moves").getBoundingClientRect();
    const accepted = item.querySelector('[data-status="accepted"]').getBoundingClientRect();
    const undecided = item.querySelector('[data-status="undecided"]').getBoundingClientRect();
    const acceptAll = panel.querySelector(".codex-action-board__bulk-button").getBoundingClientRect();
    const modeToggle = panel.querySelector(".codex-action-board__mode-toggle").getBoundingClientRect();
    return {
      panelDirection: getComputedStyle(panel).direction,
      numberX: number.x,
      movesX: moves.x,
      acceptedX: accepted.x,
      undecidedX: undecided.x,
      acceptAllX: acceptAll.x,
      modeToggleX: modeToggle.x
    };
  });
  assert.equal(rtlLayout.panelDirection, "rtl", "the whole Action Board should use RTL layout");
  assert.ok(rtlLayout.numberX > rtlLayout.movesX, "item status marker should be on the RTL leading edge");
  assert.ok(rtlLayout.acceptedX > rtlLayout.undecidedX, "status actions should read from right to left");
  assert.ok(rtlLayout.acceptAllX > rtlLayout.modeToggleX, "bulk actions should start on the right and the mode control should stay opposite");
  const rtlText = await page.evaluate(() => {
    const panel = document.querySelector(".codex-action-board");
    const styles = (selector) => {
      const style = getComputedStyle(panel.querySelector(selector));
      return { direction: style.direction, textAlign: style.textAlign };
    };
    return {
      heading: styles("h2"),
      fieldLabel: styles(".codex-action-item__label"),
      previewSummary: styles(".codex-action-board__preview summary"),
      previewText: styles(".codex-action-board__preview pre"),
      insert: styles(".codex-action-board__insert")
    };
  });
  for (const key of ["heading", "fieldLabel", "previewSummary", "previewText"]) {
    assert.deepEqual(rtlText[key], { direction: "rtl", textAlign: "right" }, `${key} should be fully RTL`);
  }
  assert.deepEqual(rtlText.insert, { direction: "rtl", textAlign: "center" }, "insert action should keep RTL text centered");
  const colors = await page.evaluate(() => {
    const panel = document.querySelector(".codex-action-board");
    const summary = panel.querySelector(".codex-action-board__summary");
    const field = panel.querySelector("textarea");
    return {
      panelForeground: getComputedStyle(panel).color,
      panelBackground: getComputedStyle(panel).backgroundColor,
      mutedForeground: getComputedStyle(summary).color,
      fieldForeground: getComputedStyle(field).color,
      fieldBackground: getComputedStyle(field).backgroundColor,
      placeholder: getComputedStyle(field, "::placeholder").color
    };
  });
  assert.ok(contrast(colors.panelForeground, colors.panelBackground) >= 4.5, "panel text contrast must meet WCAG AA");
  assert.ok(contrast(colors.mutedForeground, colors.panelBackground) >= 4.5, "secondary text contrast must meet WCAG AA");
  assert.ok(contrast(colors.fieldForeground, colors.fieldBackground) >= 4.5, `field text contrast must meet WCAG AA: ${JSON.stringify(colors)}`);
  assert.ok(contrast(colors.placeholder, colors.fieldBackground) >= 4.5, `placeholder contrast must meet WCAG AA: ${JSON.stringify(colors)}`);
  assert.equal(await page.locator(".codex-action-item").count(), 27, "split mode should extract nested bullets as separate decisions");
  assert.match(await page.locator(".codex-action-board__mode-toggle").getAttribute("title"), /ضم النقاط الفرعية/);
  assert.match(await page.locator(".codex-action-item").nth(1).locator(".codex-action-item__text").inputValue(), /Open item card/);
  assert.match(await page.locator(".codex-action-board__summary").getAttribute("aria-label"), /27 غير محسوم/);
  assert.deepEqual(
    await page.locator(".codex-action-board__summary-stat").allTextContents(),
    ["0 مقبول", "0 مرفوض", "27 غير محسوم"],
    "each RTL summary count must remain isolated with its own status"
  );
  assert.equal(
    await page.locator(".codex-action-board__summary-stat").first().evaluate((element) => getComputedStyle(element).direction),
    "ltr",
    "mixed numeric status pairs should have a stable visual order"
  );
  await page.locator(".codex-action-board__mode-toggle").click();
  assert.equal(await page.locator(".codex-action-item").count(), 25, "grouped mode should keep nested bullets inside their parent action");
  const firstActionText = await page.locator(".codex-action-item").first().locator(".codex-action-item__text").inputValue();
  assert.match(firstActionText, /\n\s+- Open item card\n\s+- Copy item number/, "grouped mode should keep nested bullets on separate lines");
  assert.match(await page.locator(".codex-action-board__mode-toggle").getAttribute("title"), /تفصيل النقاط الفرعية/);
  await page.locator(".codex-action-board__mode-toggle").click();
  assert.equal(await page.locator(".codex-action-item").count(), 27, "mode toggle should switch back to split mode");
  await page.locator(".codex-action-board__close").click();
  await page.keyboard.press("Control+Shift+A");
  assert.equal(await page.locator(".codex-action-board").isHidden(), true, "Ctrl+Shift+A must not trigger Action Board because Codex uses it for archive");
  await page.keyboard.press("Control+Alt+L");
  await page.locator(".codex-action-board").waitFor({ state: "visible" });
  assert.equal(await page.locator(".codex-action-board").getAttribute("data-mode"), "sidepanel", "keyboard shortcut should open Action Board in the side panel when available");
  await page.keyboard.press("Control+Alt+L");
  assert.equal(await page.locator(".codex-action-board").isHidden(), true, "keyboard shortcut should close Action Board when it is already open");

  await page.evaluate(() => {
    const item = document.querySelector("article ol > li:nth-child(1)");
    const range = document.createRange();
    range.selectNodeContents(item);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.locator(".codex-action-selection-trigger").waitFor({ state: "visible" });
  const selectionButtonBox = await page.locator(".codex-action-selection-trigger").boundingBox();
  const selectedItemBox = await page.locator("article ol > li").first().boundingBox();
  assert.ok(selectionButtonBox.x >= 0, "selection trigger should stay inside the viewport");
  assert.ok(
    selectionButtonBox.x + selectionButtonBox.width >= selectedItemBox.x - 80
      && selectionButtonBox.x <= selectedItemBox.x + selectedItemBox.width + 80,
    "selection trigger should stay close to the selected text"
  );
  await page.locator(".codex-action-selection-trigger").click();
  await page.locator(".codex-action-board").waitFor({ state: "visible" });
  assert.equal(await page.locator(".codex-action-item").count(), 3, "selection floating trigger should split nested bullets by default");
  assert.match(await page.locator(".codex-action-item").nth(1).locator(".codex-action-item__text").inputValue(), /Open item card/);
  await page.locator(".codex-action-board__mode-toggle").click();
  assert.equal(await page.locator(".codex-action-item").count(), 1, "selection toggle should group nested bullets inside the parent decision");
  const selectedOnlyText = await page.locator(".codex-action-item").first().locator(".codex-action-item__text").inputValue();
  assert.match(selectedOnlyText, /\n\s+- Open item card\n\s+- Copy item number/, "selection grouped mode should keep nested bullets on separate lines");
  assert.doesNotMatch(selectedOnlyText, /authentication/, "selection board should not reuse unrelated stale items");

  await page.evaluate(() => {
    const item = document.querySelector("article ol > li:nth-child(2)");
    const range = document.createRange();
    range.selectNodeContents(item);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.locator(".codex-action-selection-trigger").waitFor({ state: "visible" });
  await page.locator(".codex-action-selection-trigger").click();
  await page.locator(".codex-action-board").waitFor({ state: "visible" });
  assert.equal(await page.locator(".codex-action-item").count(), 1, "a later selection should replace previous selection items while the board is open");
  const secondSelectionText = await page.locator(".codex-action-item").first().locator(".codex-action-item__text").inputValue();
  assert.match(secondSelectionText, /authentication/, "selection board should use the newly selected text");
  assert.doesNotMatch(secondSelectionText, /Open item card/, "selection board should not reuse previous selected list items");
  await page.locator(".codex-action-board__mode-toggle").click();
  await page.locator(".codex-action-board__close").click();

  await page.evaluate(() => {
    const items = document.querySelectorAll("article ol > li");
    const range = document.createRange();
    range.setStartBefore(items[1]);
    range.setEndAfter(items[2]);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.locator(".codex-action-selection-trigger").waitFor({ state: "visible" });
  await page.locator(".codex-action-selection-trigger").click();
  await page.locator(".codex-action-board").waitFor({ state: "visible" });
  assert.equal(await page.locator(".codex-action-item").count(), 2, "selecting sibling bullets must not add a duplicate aggregate action");
  assert.match(await page.locator(".codex-action-item").first().locator(".codex-action-item__text").inputValue(), /authentication/);
  await page.locator(".codex-action-board__close").click();
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.locator(".codex-action-trigger").click();

  const items = page.locator(".codex-action-item");
  const twentiethItem = items.nth(19);
  await twentiethItem.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const listBeforeStatusChange = await page.locator(".codex-action-board__list").evaluate((element) => element.scrollTop);
  await twentiethItem.evaluate((element) => {
    const accept = Array.from(element.querySelectorAll("button")).find((button) => button.textContent?.includes("قبول"));
    accept.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    accept.click();
  });
  const listAfterStatusChange = await page.locator(".codex-action-board__list").evaluate((element) => element.scrollTop);
  assert.ok(listAfterStatusChange > 0, "changing item 20 must not jump back to the top");
  assert.ok(Math.abs(listAfterStatusChange - listBeforeStatusChange) <= 64, `changing item 20 must not make a large scroll jump: before=${listBeforeStatusChange}, after=${listAfterStatusChange}`);

  await items.nth(0).getByRole("button", { name: "قبول" }).click();
  await items.nth(0).locator(".codex-action-item__text").fill("تحسين شاشة تسجيل الدخول دون تغيير التخطيط.");
  await items.nth(0).locator(".codex-action-item__note-label textarea").fill("غيّر التحقق فقط");
  await items.nth(1).getByRole("button", { name: "رفض" }).click();
  await items.nth(2).getByRole("button", { name: "قبول" }).click();

  const preview = page.locator(".codex-action-board__preview");
  await preview.locator("summary").click();
  const previewText = await preview.locator("pre").innerText();
  assert.match(previewText, /## المطلوب تنفيذه/);
  assert.match(previewText, /غيّر التحقق فقط/);
  assert.match(previewText, /## مستبعد — لا تنفّذ/);

  const desktopScreenshot = join(tmpdir(), "codex-action-board-desktop.png");
  await page.screenshot({ path: desktopScreenshot, fullPage: true });

  await page.getByRole("button", { name: "إدراج في مربع كتابة Codex" }).click();
  const composerValue = await page.locator("form textarea").inputValue();
  assert.match(composerValue, /هذه القائمة هي المرجع النهائي/);
  assert.match(composerValue, /لا تنفّذ العناصر المستبعدة أو المؤجلة/);
  assert.equal(await page.locator(".codex-action-board").isHidden(), true, "panel should close after insertion");

  await page.setViewportSize({ width: 390, height: 760 });
  await page.locator(".codex-action-composer-trigger").click();
  await page.waitForTimeout(220);
  const mobileBox = await page.locator(".codex-action-board").boundingBox();
  assert.ok(mobileBox.width >= 389, "mobile sheet should span the viewport");
  assert.ok(mobileBox.y > 0, "mobile sheet should be anchored to the bottom");
  const mobileScreenshot = join(tmpdir(), "codex-action-board-mobile.png");
  await page.screenshot({ path: mobileScreenshot, fullPage: true });

  console.log(JSON.stringify({ desktopScreenshot, mobileScreenshot, extractedItems: 25, scrollPreserved: true, composerInserted: true }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
