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
  const defaultPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await defaultPage.goto(`http://127.0.0.1:${port}/tests/fixture.html`);
  await defaultPage.locator(".codex-action-trigger").click();
  await defaultPage.locator(".codex-action-board").waitFor({ state: "visible" });
  assert.equal(await defaultPage.locator(".codex-action-board").getAttribute("data-language"), "en", "a clean first run should default to English");
  assert.equal(await defaultPage.locator(".codex-action-board h2").innerText(), "Action Board", "default UI should be English");
  assert.equal(await defaultPage.locator(".codex-action-board").evaluate((element) => getComputedStyle(element).direction), "ltr", "default board layout should be LTR");
  assert.equal(await defaultPage.evaluate(() => Boolean(window.__CODEX_RTL_ACTIVE__)), false, "a clean English first run must not enable the RTL engine");
  assert.equal(await defaultPage.evaluate(() => Boolean(document.getElementById("codex-action-board-style"))), true, "a clean English first run must still install Action Board CSS");
  await defaultPage.locator(".codex-action-board__close").click();
  await defaultPage.evaluate(() => {
    const item = document.querySelector("article ol > li:nth-child(1)");
    const range = document.createRange();
    range.selectNodeContents(item);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await defaultPage.locator(".codex-action-selection-trigger").waitFor({ state: "visible" });
  const defaultSelectionButtonBox = await defaultPage.locator(".codex-action-selection-trigger").boundingBox();
  const defaultSelectedItemBox = await defaultPage.locator("article ol > li").first().boundingBox();
  assert.ok(
    defaultSelectionButtonBox.x >= defaultSelectedItemBox.x + defaultSelectedItemBox.width / 2,
    "English selection trigger should stay on the right side of the selected text"
  );
  await defaultPage.close();

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => localStorage.setItem("codex-action-board-language", "ar"));
  await page.goto(`http://127.0.0.1:${port}/tests/fixture.html`);

  assert.equal(await page.locator(".codex-action-trigger").count(), 1, "response trigger should be injected");
  const responseTriggerPlacement = await page.locator(".codex-action-trigger").evaluate((trigger) => ({
    parentClass: trigger.parentElement?.className || "",
    insideCopyTooltipTrigger: Boolean(trigger.closest(".copy-tooltip-trigger"))
  }));
  assert.match(responseTriggerPlacement.parentClass, /copy-tooltip-trigger|actions/, "response trigger should stay visually grouped with the native response actions");
  const assistantCopyTitle = await page.locator("article[data-message-author-role='assistant'] .actions button[aria-label='Copy']").getAttribute("title");
  assert.equal(assistantCopyTitle, "Copy", "Action Board must not mutate native Copy button attributes");
  const responseTriggerLabels = await page.locator(".codex-action-trigger").evaluate((trigger) => ({
    title: trigger.getAttribute("title"),
    aria: trigger.getAttribute("aria-label")
  }));
  assert.equal(responseTriggerLabels.title, null, "response trigger should not show a native tooltip");
  assert.ok(responseTriggerLabels.aria, "response trigger should keep an accessible label");
  assert.doesNotMatch(responseTriggerLabels.aria, /copy/i, "response trigger must not reuse the Copy button label");
  await page.locator(".codex-action-trigger").hover();
  assert.equal(
    await page.locator("article[data-message-author-role='assistant'] .actions button[aria-label='Copy']").getAttribute("title"),
    "Copy",
    "hovering Action Board must not dispatch synthetic hover cleanup into native Codex controls"
  );
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
  await page.locator(".codex-action-trigger").evaluate((trigger) => trigger.remove());
  await page.waitForFunction(() => document.querySelectorAll(".codex-action-trigger").length === 1);
  assert.equal(await page.locator(".codex-action-trigger").count(), 1, "navigation watchdog should restore a removed response trigger without duplicates");
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
  const headingBox = await page.locator(".codex-action-board__header > div").boundingBox();
  assert.ok(closeBox.x + closeBox.width / 2 < desktopBox.x + desktopBox.width / 2, "panel close button should stay on the inner side away from the app window close button");
  assert.ok(closeBox.width >= 44 && closeBox.height >= 44, "close button should provide a reliable 44px hit target");
  assert.ok(Math.abs((closeBox.y + closeBox.height / 2) - (headingBox.y + headingBox.height / 2)) <= 12, "Arabic close button should share the title row instead of dropping below it");
  assert.ok(desktopBox.x + desktopBox.width - headingBox.x - headingBox.width >= 88, "Arabic title should reserve the native side-panel controls area");
  assert.equal(await page.locator(".codex-action-board__close svg").evaluate((element) => getComputedStyle(element).pointerEvents), "none", "close icon should not intercept pointer events");
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
  await page.locator(".codex-action-board__language").click();
  assert.equal(await page.locator(".codex-action-board").getAttribute("data-language"), "en");
  assert.equal(await page.locator(".codex-action-board").evaluate((element) => getComputedStyle(element).direction), "ltr");
  assert.equal(await page.locator(".codex-action-board h2").innerText(), "Action Board");
  const englishCloseBox = await page.locator(".codex-action-board__close").boundingBox();
  assert.ok(desktopBox.x + desktopBox.width - englishCloseBox.x - englishCloseBox.width >= 88, "English close button should reserve the native side-panel controls area");
  const englishHeaderAlignment = await page.evaluate(() => {
    const close = document.querySelector(".codex-action-board__close").getBoundingClientRect();
    const heading = document.querySelector(".codex-action-board__header > div").getBoundingClientRect();
    return Math.abs((close.y + close.height / 2) - (heading.y + heading.height / 2));
  });
  assert.ok(englishHeaderAlignment <= 12, "English close button should share the same title-row alignment");
  assert.equal(await page.locator(".codex-action-board__insert").innerText(), "Insert into composer");
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute("data-codex-rtl-root")), false, "English mode should remove the Codex RTL root marker");
  assert.equal(await page.evaluate(() => window.__CODEX_RTL_ACTIVE__), false, "English mode should stop RTL processing");
  assert.equal(await page.evaluate(() => Boolean(window.__CODEX_RTL_OBSERVER__)), false, "English mode should disconnect and remove the RTL observer");
  assert.equal(await page.locator("[data-codex-rtl], [data-codex-bidi], [data-codex-code-ltr], [data-codex-ltr-run]").count(), 0, "English mode should clean prior RTL mutations");
  assert.match(await page.locator(".codex-action-board__preview pre").textContent(), /final source of truth/);
  await page.locator(".codex-action-board__language").click();
  assert.equal(await page.locator(".codex-action-board").getAttribute("data-language"), "ar");
  assert.equal(await page.locator(".codex-action-board").evaluate((element) => getComputedStyle(element).direction), "rtl");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.codexRtlRoot), "true", "switching back to Arabic should reactivate RTL");
  assert.equal(await page.evaluate(() => window.__CODEX_RTL_ACTIVE__), true);
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
  assert.equal(await page.locator(".codex-action-board__mode-toggle").getAttribute("data-mode"), "grouped", "sub-items should be grouped by default");
  assert.equal(await page.locator(".codex-action-item").count(), 25, "grouped mode should keep nested bullets inside their parent action by default");
  const firstGroupedActionText = await page.locator(".codex-action-item").first().locator(".codex-action-item__text").inputValue();
  assert.match(firstGroupedActionText, /\n\s+- Open item card\n\s+- Copy item number/, "default grouped mode should keep nested bullets on separate lines");
  assert.match(await page.locator(".codex-action-board__summary").getAttribute("aria-label"), /25 /);
  const summaryStats = await page.locator(".codex-action-board__summary-stat").allTextContents();
  assert.equal(summaryStats.length, 3, "each RTL summary count must remain isolated with its own status");
  assert.match(summaryStats.at(-1), /^25 /, "undecided summary should show the grouped item count");
  assert.equal(
    await page.locator(".codex-action-board__summary-stat").first().evaluate((element) => getComputedStyle(element).direction),
    "ltr",
    "mixed numeric status pairs should have a stable visual order"
  );
  await page.locator(".codex-action-board__mode-toggle").click();
  assert.equal(await page.locator(".codex-action-board__mode-toggle").getAttribute("data-mode"), "split");
  assert.equal(await page.locator(".codex-action-item").count(), 27, "split mode should extract nested bullets as separate decisions");
  assert.match(await page.locator(".codex-action-item").nth(1).locator(".codex-action-item__text").inputValue(), /Open item card/);
  await page.locator(".codex-action-board__mode-toggle").click();
  assert.equal(await page.locator(".codex-action-board__mode-toggle").getAttribute("data-mode"), "grouped");
  assert.equal(await page.locator(".codex-action-item").count(), 25, "mode toggle should switch back to grouped mode");
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
  assert.equal(await page.locator(".codex-action-board__mode-toggle").getAttribute("data-mode"), "grouped");
  assert.equal(await page.locator(".codex-action-item").count(), 1, "selection floating trigger should group nested bullets by default");
  const selectedOnlyText = await page.locator(".codex-action-item").first().locator(".codex-action-item__text").inputValue();
  assert.match(selectedOnlyText, /\n\s+- Open item card\n\s+- Copy item number/, "selection grouped mode should keep nested bullets on separate lines");
  assert.doesNotMatch(selectedOnlyText, /authentication/, "selection board should not reuse unrelated stale items");
  await page.locator(".codex-action-board__mode-toggle").click();
  assert.equal(await page.locator(".codex-action-board__mode-toggle").getAttribute("data-mode"), "split");
  assert.equal(await page.locator(".codex-action-item").count(), 3, "selection toggle should split nested bullets into separate decisions");
  assert.match(await page.locator(".codex-action-item").nth(1).locator(".codex-action-item__text").inputValue(), /Open item card/);
  await page.locator(".codex-action-board__mode-toggle").click();
  assert.equal(await page.locator(".codex-action-board__mode-toggle").getAttribute("data-mode"), "grouped");

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
  assert.equal(await page.locator(".codex-action-item").count(), 1, "grouped sibling selections should stay as one aggregate action");
  const siblingSelectionText = await page.locator(".codex-action-item").first().locator(".codex-action-item__text").inputValue();
  assert.match(siblingSelectionText, /authentication/);
  assert.match(siblingSelectionText, /\n\s+- /, "grouped sibling selection should preserve the second selected bullet on its own line");
  await page.locator(".codex-action-board__close").click();
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.locator(".codex-action-trigger").click();

  const items = page.locator(".codex-action-item");
  const twentiethItem = items.nth(19);
  await twentiethItem.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const listBeforeStatusChange = await page.locator(".codex-action-board__list").evaluate((element) => element.scrollTop);
  await twentiethItem.evaluate((element) => {
    const accept = element.querySelector('button[data-status="accepted"]');
    accept.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    accept.click();
  });
  const listAfterStatusChange = await page.locator(".codex-action-board__list").evaluate((element) => element.scrollTop);
  assert.ok(listAfterStatusChange > 0, "changing item 20 must not jump back to the top");
  assert.ok(Math.abs(listAfterStatusChange - listBeforeStatusChange) <= 64, `changing item 20 must not make a large scroll jump: before=${listBeforeStatusChange}, after=${listAfterStatusChange}`);

  await items.nth(0).locator('button[data-status="accepted"]').click();
  await items.nth(0).locator(".codex-action-item__text").fill("طھط­ط³ظٹظ† ط´ط§ط´ط© طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„ ط¯ظˆظ† طھط؛ظٹظٹط± ط§ظ„طھط®ط·ظٹط·.");
  await items.nth(0).locator(".codex-action-item__note-label textarea").fill("ط؛ظٹظ‘ط± ط§ظ„طھط­ظ‚ظ‚ ظپظ‚ط·");
  await items.nth(1).locator('button[data-status="rejected"]').click();
  await items.nth(2).locator('button[data-status="accepted"]').click();

  const preview = page.locator(".codex-action-board__preview");
  await preview.locator("summary").click();
  const previewText = await preview.locator("pre").innerText();
  assert.match(previewText, /## المطلوب تنفيذه/);
  assert.match(previewText, /ط؛ظٹظ‘ط± ط§ظ„طھط­ظ‚ظ‚ ظپظ‚ط·/);
  assert.match(previewText, /## مستبعد — لا تنفّذ/);

  const desktopScreenshot = join(tmpdir(), "codex-action-board-desktop.png");
  await page.screenshot({ path: desktopScreenshot, fullPage: true });

  await page.locator(".codex-action-board__insert").click();
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
