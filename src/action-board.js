(function codexActionBoard() {
  "use strict";

  if (window.__CODEX_ACTION_BOARD_ACTIVE__) {
    window.__CODEX_ACTION_BOARD_OBSERVER__?.disconnect();
    window.__CODEX_ACTION_BOARD_EVENTS__?.abort();
    delete window.__CODEX_ACTION_BOARD_OPEN_CONTEXT__;
    document.querySelectorAll(
      ".codex-action-board, .codex-action-trigger, .codex-action-composer-trigger, .codex-action-side-panel-entry, .codex-action-sr-only, .codex-action-selection-trigger, .codex-action-context-menu, .codex-action-native-menu-item"
    ).forEach((element) => element.remove());
    document.querySelectorAll("[data-codex-action-ready]").forEach((element) => delete element.dataset.codexActionReady);
  }
  const core = window.__CODEX_ACTION_BOARD_CORE__;
  if (!core) throw new Error("Action Board core was not loaded.");

  const RESPONSE_SELECTOR = [
    "[data-codex-assistant-response='true']",
    "[data-message-author-role='assistant' i]",
    "article[data-testid*='assistant' i]",
    "article"
  ].join(",");
  const state = {
    sourceText: "",
    items: [],
    sourceElement: null,
    sourceContext: null,
    returnFocus: null,
    subitemMode: "split",
    pendingListScrollTop: undefined
  };
  let panel;
  let liveRegion;
  let pendingContextAction = null;
  let selectionTrigger;
  let sidePanelEntry;
  const eventController = new AbortController();
  window.__CODEX_ACTION_BOARD_EVENTS__ = eventController;
  const ACTION_BOARD_ICON_PATHS = '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.4 1.4L7.5 4.8M3.5 12l1.4 1.4 2.6-2.6M3.5 18l1.4 1.4 2.6-2.6"/>';

  function forceRtl(element) {
    element.dir = "rtl";
    element.style.setProperty("direction", "rtl", "important");
    element.style.setProperty("text-align", "right", "important");
    return element;
  }

  const icon = (paths) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = paths;
    return svg;
  };

  function button(label, className, onClick, paths) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = className;
    el.setAttribute("aria-label", label);
    el.title = label;
    if (paths) el.append(icon(paths));
    el.addEventListener("click", onClick);
    return el;
  }

  function announce(message) {
    if (liveRegion) liveRegion.textContent = message;
  }

  function runPendingContextAction() {
    const action = pendingContextAction;
    pendingContextAction = null;
    if (!action) return;
    if (action.selected) openBoard(action.selected.response, action.selected.text, action.selected.fragment, action.selected.listItem);
    else openBoard(action.response);
    window.getSelection()?.removeAllRanges();
    hideSelectionTrigger();
  }

  function showContextMenu(event) {
    const selected = selectedAssistantText();
    const target = event.target?.nodeType === Node.ELEMENT_NODE ? event.target : event.target?.parentElement;
    const response = selected?.response || target?.closest?.(RESPONSE_SELECTOR);
    if (!selected && !isAssistantResponse(response)) return;
    pendingContextAction = selected ? { selected } : { response };
  }

  function setupExtensionMessages() {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.onMessage) return;
    runtime.onMessage.addListener((message) => {
      if (message?.type !== "codex-action-board:open-context") return undefined;
      if (!pendingContextAction) {
        const selected = selectedAssistantText();
        if (selected) pendingContextAction = { selected };
      }
      runPendingContextAction();
      return undefined;
    });
  }

  function isAssistantResponse(el) {
    if (!el || el.closest("[data-codex-action-board]")) return false;
    if (el.matches("[data-message-author-role='user' i]")) return false;
    if (el.querySelector("[data-message-author-role='user' i]")) return false;
    return Boolean((el.innerText || "").trim()) && Boolean(el.querySelector("p, li, pre, h1, h2, h3, h4"));
  }

  function responseText(el) {
    return (el.innerText || el.textContent || "").trim();
  }

  function parseResponse(el, mode = state.subitemMode) {
    const listItems = Array.from(el.querySelectorAll("li"))
      .filter((item) => !item.closest("pre, [data-codex-action-board]"))
      .filter((item) => mode === "split" || !item.parentElement?.closest("li"))
      .map((item, index) => core.createItem(mode === "split" ? ownListItemText(item) : listItemText(item), index))
      .filter((item) => core.clean(item.originalText));
    return listItems.length ? listItems : core.parseText(responseText(el));
  }

  function parseListItemsFromContainer(container, mode = state.subitemMode) {
    if (!container?.querySelectorAll) return [];
    return Array.from(container.querySelectorAll("li"))
      .filter((item) => !item.closest("pre, [data-codex-action-board]"))
      .filter((item) => mode === "split" || !item.parentElement?.closest("li"))
      .map((item, index) => core.createItem(mode === "split" ? ownListItemText(item) : listItemText(item), index))
      .filter((item) => core.clean(item.originalText));
  }

  function listItemText(item) {
    const lines = [];
    for (const node of item.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = core.clean(node.textContent);
        if (text) lines.push(text);
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || node.matches("script, style")) continue;
      if (node.matches("ul, ol")) {
        node.querySelectorAll(":scope > li").forEach((child) => {
          const text = core.normalizeActionText(child.innerText || child.textContent);
          if (text) lines.push(`  - ${text.replace(/\n/g, "\n    ")}`);
        });
        continue;
      }
      const text = core.normalizeActionText(node.innerText || node.textContent);
      if (text) lines.push(text);
    }
    return lines.join("\n");
  }

  function ownListItemText(item) {
    const lines = [];
    for (const node of item.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = core.clean(node.textContent);
        if (text) lines.push(text);
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || node.matches("script, style, ul, ol")) continue;
      const text = core.normalizeActionText(node.innerText || node.textContent);
      if (text) lines.push(text);
    }
    return lines.join("\n");
  }

  function fragmentLeadText(fragment) {
    if (!fragment?.childNodes) return "";
    const lines = [];
    for (const node of fragment.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = core.clean(node.textContent);
        if (text) lines.push(text);
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || node.matches("script, style, ul, ol, li")) continue;
      const prose = node.cloneNode(true);
      prose.querySelectorAll?.("ul, ol").forEach((list) => list.remove());
      const text = core.normalizeActionText(prose.innerText || prose.textContent);
      if (text) lines.push(text);
    }
    return lines.join("\n");
  }

  function fragmentGroupedText(text, fragment) {
    const lead = fragmentLeadText(fragment);
    const bullets = parseListItemsFromContainer(fragment, "split")
      .map((item) => `  - ${core.normalizeActionText(item.originalText).replace(/\n/g, "\n    ")}`);
    return [lead, ...bullets].filter(Boolean).join("\n") || text;
  }

  function findActionRow(el) {
    const copyButton = Array.from(el.querySelectorAll("button")).find((candidate) => {
      const name = `${candidate.getAttribute("aria-label") || ""} ${candidate.title || ""}`.toLowerCase();
      return name.includes("copy") || name.includes("نسخ");
    });
    return copyButton?.parentElement || null;
  }

  function clearSiblingActionHover(trigger) {
    trigger.parentElement?.querySelectorAll("button").forEach((button) => {
      if (button === trigger) return;
      button.blur();
      button.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
      button.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    });
  }

  function openSelectedText() {
    const selected = selectedAssistantText();
    if (!selected) return;
    openBoard(selected.response, selected.text, selected.fragment, selected.listItem);
    window.getSelection()?.removeAllRanges();
    hideSelectionTrigger();
  }

  function hideSelectionTrigger() {
    if (!selectionTrigger) return;
    selectionTrigger.hidden = true;
  }

  function showSelectionTrigger() {
    if (!selectionTrigger) {
      hideSelectionTrigger();
      return;
    }
    const selected = selectedAssistantText();
    if (!selected?.rect || !selected.response) {
      hideSelectionTrigger();
      return;
    }
    const rect = selected.rect;
    const responseRect = selected.response.getBoundingClientRect();
    const size = 32;
    const gap = 10;
    const viewportPadding = 8;
    const minLeft = Math.max(viewportPadding, Math.min(window.innerWidth - size - viewportPadding, responseRect.left + 12));
    const maxLeft = Math.max(minLeft, Math.min(window.innerWidth - size - viewportPadding, responseRect.right - size - 12));
    const left = clamp(rect.left - size - gap, minLeft, maxLeft);
    const top = clamp(
      rect.top + Math.min(24, Math.max(0, rect.height / 2)) - size / 2,
      viewportPadding,
      window.innerHeight - size - viewportPadding
    );
    selectionTrigger.style.left = `${Math.round(left)}px`;
    selectionTrigger.style.top = `${Math.round(top)}px`;
    selectionTrigger.hidden = false;
  }

  function scheduleSelectionTrigger() {
    requestAnimationFrame(showSelectionTrigger);
  }

  function decorateResponse(el) {
    if (!isAssistantResponse(el) || el.dataset.codexActionReady) return;
    el.dataset.codexActionReady = "true";
    const trigger = button(
      "فتح في لوحة الإجراءات",
      "codex-action-trigger",
      () => openBoard(el),
      ACTION_BOARD_ICON_PATHS
    );
    trigger.addEventListener("mouseenter", () => clearSiblingActionHover(trigger));
    trigger.addEventListener("focus", () => clearSiblingActionHover(trigger));
    const row = findActionRow(el);
    if (row) {
      trigger.classList.add("codex-action-trigger--native");
      row.append(trigger);
    } else {
      trigger.classList.add("codex-action-trigger--fallback");
      el.append(trigger);
    }
  }

  function discoverCodexResponses(root) {
    const buttons = root.querySelectorAll?.("button") || [];
    for (const action of buttons) {
      const label = (action.getAttribute("aria-label") || "").trim().toLowerCase();
      if (!isCodexResponseActionLabel(label)) continue;
      let candidate = action.parentElement;
      for (let depth = 0; candidate && depth < 7; depth += 1, candidate = candidate.parentElement) {
        const hasContent = Boolean(candidate.querySelector("p, li, pre, h1, h2, h3, h4"));
        const hasResponseActions = Boolean(candidate.querySelector(
          "button[aria-label='Good response'], button[aria-label='Bad response'], button[aria-label='Fork from this point']"
        ));
        if (hasContent && hasResponseActions) {
          candidate.dataset.codexAssistantResponse = "true";
          decorateResponse(candidate);
          break;
        }
      }
    }
  }

  function isCodexResponseActionLabel(label) {
    return label.includes("copy")
      || label.includes("good response")
      || label.includes("bad response")
      || label.includes("fork from this point")
      || label.includes("نسخ");
  }

  function scanResponses(root = document) {
    discoverCodexResponses(root);
    if (root.nodeType === Node.ELEMENT_NODE && root.matches?.(RESPONSE_SELECTOR)) decorateResponse(root);
    root.querySelectorAll?.(RESPONSE_SELECTOR).forEach(decorateResponse);
    ensureSidePanelEntry();
    ensureComposerTrigger();
  }

  function parseSelection(text, fragment, listItem, mode = state.subitemMode) {
    if (listItem && mode === "grouped") {
      const value = listItemText(listItem);
      if (value) return [core.createItem(value, 0)];
    }
    if (listItem && mode === "split") {
      const parent = core.createItem(ownListItemText(listItem), 0);
      const children = parseListItemsFromContainer(listItem, "split")
        .filter((item) => core.clean(item.originalText) !== core.clean(parent.originalText));
      return [parent, ...children].filter((item) => core.clean(item.originalText)).map((item, index) => {
        item.order = index;
        return item;
      });
    }
    if (mode === "grouped") {
      const value = fragmentGroupedText(text, fragment);
      if (value) return [core.createItem(value, 0)];
    }
    const lead = fragmentLeadText(fragment);
    const listItems = parseListItemsFromContainer(fragment, "split");
    if (lead && listItems.length) return [core.createItem(lead, 0), ...listItems].map((item, index) => {
      item.order = index;
      return item;
    });
    if (listItems.length) return listItems;
    const parsed = core.parseText(text);
    return parsed.length ? parsed : [core.createItem(text, 0)];
  }

  function openBoard(source, selectedText, selectedFragment, selectedListItem) {
    hideSelectionTrigger();
    state.returnFocus = document.activeElement;
    state.sourceElement = source || state.sourceElement;
    if (selectedText) {
      state.sourceText = selectedText;
      state.sourceContext = { type: "selection", source, text: selectedText, fragment: selectedFragment, listItem: selectedListItem };
      state.items = parseSelection(selectedText, selectedFragment, selectedListItem);
    } else if (source) {
      state.sourceText = responseText(source);
      state.sourceContext = { type: "response", source };
      state.items = parseResponse(source);
    }
    mountPanel();
    renderPanel();
    panel.hidden = false;
    document.documentElement.dataset.codexActionBoardOpen = "true";
    ensureComposerTrigger();
    panel.querySelector(".codex-action-board__close")?.focus();
    announce(`فُتحت لوحة الإجراءات وبها ${state.items.length} عناصر.`);
  }

  function reparseCurrentSource() {
    const context = state.sourceContext;
    if (!context) return;
    if (context.type === "selection") {
      state.items = parseSelection(context.text, context.fragment, context.listItem);
      return;
    }
    if (context.type === "response" && context.source) {
      state.sourceText = responseText(context.source);
      state.items = parseResponse(context.source);
    }
  }

  function toggleSubitemMode() {
    state.subitemMode = state.subitemMode === "split" ? "grouped" : "split";
    reparseCurrentSource();
    renderPanel();
    announce(state.subitemMode === "split"
      ? "تم تفصيل النقاط الفرعية كقرارات منفصلة."
      : "تم ضم النقاط الفرعية داخل قرار واحد.");
  }

  function closeBoard() {
    panel.hidden = true;
    delete document.documentElement.dataset.codexActionBoardOpen;
    state.returnFocus?.focus?.();
  }

  function setStatus(id, status) {
    const item = state.items.find((entry) => entry.id === id);
    if (!item) return;
    item.status = status;
    syncItemStatusUI(item);
    updateSummary();
    restorePendingListScroll();
  }

  function rememberListScroll() {
    state.pendingListScrollTop = panel?.querySelector(".codex-action-board__list")?.scrollTop;
  }

  function restorePendingListScroll() {
    const scrollTop = state.pendingListScrollTop;
    state.pendingListScrollTop = undefined;
    if (typeof scrollTop !== "number") return;
    const list = panel?.querySelector(".codex-action-board__list");
    if (!list) return;
    const restore = () => { list.scrollTop = scrollTop; };
    restore();
    requestAnimationFrame(restore);
    setTimeout(restore, 0);
    setTimeout(restore, 50);
  }

  function syncItemStatusUI(item) {
    const row = panel.querySelector(`[data-item-id="${item.id}"]`);
    if (!row) return;
    row.dataset.status = item.status;
    row.querySelectorAll(".codex-action-item__status").forEach((control) => {
      control.setAttribute("aria-pressed", String(control.dataset.status === item.status));
    });
  }

  function setAllStatuses(status) {
    state.items.forEach((item) => {
      item.status = status;
      syncItemStatusUI(item);
    });
    updateSummary();
  }

  function moveItem(id, direction) {
    const index = state.items.findIndex((entry) => entry.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= state.items.length) return;
    [state.items[index], state.items[target]] = [state.items[target], state.items[index]];
    state.items.forEach((item, order) => { item.order = order; });
    const scrollTop = panel.querySelector(".codex-action-board__list")?.scrollTop || 0;
    renderPanel({ scrollTop, focusItemId: id });
  }

  function statusButton(item, status, label) {
    const el = button(label, "codex-action-item__status", () => setStatus(item.id, status));
    el.dataset.status = status;
    el.setAttribute("aria-pressed", String(item.status === status));
    el.textContent = label;
    el.addEventListener("pointerdown", rememberListScroll);
    el.addEventListener("mousedown", rememberListScroll);
    return el;
  }

  function renderItem(item, index) {
    const row = document.createElement("li");
    forceRtl(row);
    row.className = "codex-action-item";
    row.dataset.itemId = item.id;
    row.dataset.status = item.status;

    const top = document.createElement("div");
    forceRtl(top);
    top.className = "codex-action-item__top";
    const number = document.createElement("span");
    number.className = "codex-action-item__number";
    number.textContent = String(index + 1);
    number.setAttribute("aria-hidden", "true");
    const statuses = document.createElement("div");
    forceRtl(statuses);
    statuses.className = "codex-action-item__statuses";
    statuses.setAttribute("aria-label", "حالة العنصر");
    statuses.append(statusButton(item, "accepted", "قبول"), statusButton(item, "rejected", "رفض"), statusButton(item, "undecided", "لاحقًا"));
    const moves = document.createElement("div");
    moves.className = "codex-action-item__moves";
    const up = button("تحريك لأعلى", "codex-action-item__move", () => moveItem(item.id, -1), '<path d="m6 15 6-6 6 6"/>');
    up.disabled = index === 0;
    const down = button("تحريك لأسفل", "codex-action-item__move", () => moveItem(item.id, 1), '<path d="m6 9 6 6 6-6"/>');
    down.disabled = index === state.items.length - 1;
    moves.append(up, down);
    top.append(number, statuses, moves);

    const label = document.createElement("label");
    forceRtl(label);
    label.className = "codex-action-item__label";
    label.textContent = "نص الإجراء";
    const text = document.createElement("textarea");
    text.className = "codex-action-item__text";
    text.value = item.editedText;
    text.rows = Math.min(8, Math.max(2, item.editedText.split("\n").length + 1));
    text.addEventListener("input", () => {
      item.editedText = text.value;
      row.dataset.edited = String(core.clean(item.originalText) !== core.clean(item.editedText));
      updateSummary();
    });
    label.append(text);

    const noteLabel = document.createElement("label");
    forceRtl(noteLabel);
    noteLabel.className = "codex-action-item__note-label";
    noteLabel.textContent = "ملاحظة أو توجيه (اختياري)";
    const note = document.createElement("textarea");
    note.rows = 1;
    note.value = item.note;
    note.placeholder = "مثال: حافظ على التصميم الحالي";
    note.addEventListener("input", () => { item.note = note.value; updateSummary(); });
    noteLabel.append(note);

    row.append(top, label, noteLabel);
    return row;
  }

  function counts() {
    return state.items.reduce((result, item) => {
      result[item.status] += 1;
      return result;
    }, { accepted: 0, rejected: 0, undecided: 0 });
  }

  function updateSummary() {
    const summary = panel?.querySelector(".codex-action-board__summary");
    if (!summary) return;
    const count = counts();
    const statuses = [
      [count.accepted, "مقبول"],
      [count.rejected, "مرفوض"],
      [count.undecided, "غير محسوم"]
    ];
    summary.replaceChildren();
    statuses.forEach(([value, label], index) => {
      if (index) {
        const separator = document.createElement("span");
        separator.className = "codex-action-board__summary-separator";
        separator.textContent = "·";
        separator.setAttribute("aria-hidden", "true");
        summary.append(separator);
      }
      const stat = document.createElement("span");
      stat.className = "codex-action-board__summary-stat";
      stat.style.setProperty("direction", "ltr", "important");
      const number = document.createElement("bdi");
      number.dir = "ltr";
      number.textContent = String(value);
      const text = document.createElement("span");
      text.dir = "rtl";
      text.textContent = label;
      stat.append(number, document.createTextNode(" "), text);
      summary.append(stat);
    });
    summary.setAttribute("aria-label", `${count.accepted} مقبول، ${count.rejected} مرفوض، ${count.undecided} غير محسوم`);
    panel.querySelector(".codex-action-board__insert").disabled = count.accepted === 0;
    const preview = panel.querySelector(".codex-action-board__preview pre");
    if (preview) preview.textContent = core.formatPrompt(state.items);
  }

  function insertIntoComposer() {
    const prompt = core.formatPrompt(state.items);
    const composer = Array.from(document.querySelectorAll("textarea, [contenteditable='true'], [role='textbox']"))
      .find((el) => !el.closest("[data-codex-action-board]") && el.getClientRects().length);
    if (!composer) {
      announce("تعذّر العثور على مربع كتابة Codex.");
      panel.dataset.error = "composer";
      renderError("تعذّر العثور على مربع الكتابة. اترك المحادثة مفتوحة وحاول مجددًا.");
      return;
    }
    composer.focus();
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(composer), "value")?.set;
      setter?.call(composer, prompt);
    } else {
      composer.textContent = prompt;
    }
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));
    composer.dispatchEvent(new Event("change", { bubbles: true }));
    announce("تم إدراج القرارات في مربع الكتابة دون إرسالها.");
    closeBoard();
  }

  function renderError(message) {
    let error = panel.querySelector(".codex-action-board__error");
    if (!error) {
      error = document.createElement("p");
      error.className = "codex-action-board__error";
      error.setAttribute("role", "alert");
      panel.querySelector(".codex-action-board__footer")?.prepend(error);
    }
    error.textContent = message;
  }

  function renderPanel({ scrollTop = 0, focusItemId } = {}) {
    panel.replaceChildren();
    forceRtl(panel);
    const header = document.createElement("header");
    header.className = "codex-action-board__header";
    const headingWrap = document.createElement("div");
    forceRtl(headingWrap);
    const heading = document.createElement("h2");
    forceRtl(heading);
    heading.id = "codex-action-board-title";
    heading.textContent = "لوحة الإجراءات";
    const summary = document.createElement("p");
    forceRtl(summary);
    summary.className = "codex-action-board__summary";
    headingWrap.append(heading, summary);
    const close = button("إغلاق اللوحة", "codex-action-board__close", closeBoard, '<path d="m6 6 12 12M18 6 6 18"/>');
    header.append(headingWrap, close);

    const bulk = document.createElement("div");
    forceRtl(bulk);
    bulk.className = "codex-action-board__bulk";
    const acceptAll = button("قبول الكل", "codex-action-board__bulk-button", () => {
      setAllStatuses("accepted");
    });
    acceptAll.textContent = "قبول الكل";
    const clear = button("إعادة تعيين الحالات", "codex-action-board__bulk-button", () => {
      setAllStatuses("undecided");
    });
    clear.textContent = "إعادة التعيين";
    const subitemToggle = button(
      state.subitemMode === "split" ? "ضم النقاط الفرعية داخل قرار واحد" : "تفصيل النقاط الفرعية كقرارات منفصلة",
      "codex-action-board__mode-toggle",
      toggleSubitemMode,
      state.subitemMode === "split"
        ? '<path d="M8 7h11M8 12h11M8 17h11"/><path d="M4 7h.01M4 12h.01M4 17h.01"/>'
        : '<path d="M8 6h11M8 18h11"/><path d="M11 10h8M11 14h8"/><path d="M4 6h.01M4 18h.01"/><path d="M7 10h.01M7 14h.01"/>'
    );
    subitemToggle.setAttribute("aria-pressed", String(state.subitemMode === "grouped"));
    subitemToggle.dataset.mode = state.subitemMode;
    bulk.append(acceptAll, clear, subitemToggle);

    const list = document.createElement("ol");
    forceRtl(list);
    list.className = "codex-action-board__list";
    if (state.items.length) state.items.forEach((item, index) => list.append(renderItem(item, index)));
    else {
      const empty = document.createElement("li");
      empty.className = "codex-action-board__empty";
      empty.textContent = "لم نجد قائمة قابلة للتحويل في هذا الرد. حدّد نصًا وأضفه إلى اللوحة.";
      list.append(empty);
    }

    const preview = document.createElement("details");
    forceRtl(preview);
    preview.className = "codex-action-board__preview";
    const previewSummary = document.createElement("summary");
    forceRtl(previewSummary);
    previewSummary.textContent = "معاينة الرسالة";
    const output = document.createElement("pre");
    forceRtl(output);
    output.textContent = core.formatPrompt(state.items);
    preview.append(previewSummary, output);

    const footer = document.createElement("footer");
    forceRtl(footer);
    footer.className = "codex-action-board__footer";
    const insert = button("إدراج في مربع كتابة Codex", "codex-action-board__insert", insertIntoComposer);
    forceRtl(insert);
    insert.style.setProperty("text-align", "center", "important");
    insert.textContent = "إدراج في مربع الكتابة";
    footer.append(insert);
    panel.append(header, bulk, list, preview, footer);
    updateSummary();
    list.scrollTop = scrollTop;
    if (focusItemId) panel.querySelector(`[data-item-id="${focusItemId}"] .codex-action-item__move`)?.focus();
  }

  function ensureComposerTrigger() {
    if (!state.items.length) return;
    const existing = document.querySelector(".codex-action-composer-trigger");
    if (existing) {
      existing.dataset.count = String(state.items.length);
      return;
    }
    const composer = Array.from(document.querySelectorAll("form")).find((el) => el.querySelector("textarea, [contenteditable='true'], [role='textbox']"));
    if (!composer) return;
    const trigger = button("فتح لوحة الإجراءات", "codex-action-composer-trigger", () => openBoard(null), ACTION_BOARD_ICON_PATHS);
    trigger.dataset.count = String(state.items.length);
    composer.append(trigger);
  }

  function sidePanelRoot() {
    const labels = ["Review", "Terminal", "Browser", "Files", "Side chat"];
    return Array.from(document.querySelectorAll("aside")).find((aside) => {
      if (aside.closest("[data-codex-action-board]")) return false;
      const text = aside.innerText || "";
      if (!labels.every((label) => text.includes(label))) return false;
      const rect = aside.getBoundingClientRect();
      return rect.width >= 260 && rect.height >= 300 && rect.left > window.innerWidth * 0.45;
    }) || null;
  }

  function sidePanelMenuList(root = sidePanelRoot()) {
    if (!root) return null;
    const buttons = Array.from(root.querySelectorAll("button"));
    const review = buttons.find((candidate) => (candidate.innerText || "").includes("Review"));
    const sideChat = buttons.find((candidate) => (candidate.innerText || "").includes("Side chat"));
    const list = sideChat?.parentElement || review?.parentElement || null;
    if (!list) return null;
    const text = list.innerText || "";
    return text.includes("Review") && text.includes("Side chat") ? list : null;
  }

  function ensureSidePanelEntry() {
    const list = sidePanelMenuList();
    if (!list) return;
    if (sidePanelEntry?.isConnected) return;
    const template = Array.from(list.querySelectorAll("button")).find((candidate) => (candidate.innerText || "").includes("Side chat"))
      || list.querySelector("button");
    sidePanelEntry = template?.cloneNode(true) || document.createElement("button");
    sidePanelEntry.type = "button";
    sidePanelEntry.removeAttribute("id");
    sidePanelEntry.className = template?.className || "codex-action-side-panel-entry";
    sidePanelEntry.classList.add("codex-action-side-panel-entry");
    sidePanelEntry.title = "فتح لوحة الإجراءات";
    sidePanelEntry.setAttribute("aria-label", "فتح لوحة الإجراءات");
    replaceShortcutText(sidePanelEntry, "Ctrl+Alt+L");
    replaceSidePanelIcon(sidePanelEntry);
    replaceFirstText(sidePanelEntry, "لوحة الإجراءات");
    sidePanelEntry.addEventListener("click", () => openBoard(null));
    list.append(sidePanelEntry);
  }

  function replaceSidePanelIcon(root) {
    const svg = root.querySelector("svg");
    if (svg) {
      normalizeActionBoardIconSvg(svg);
      svg.innerHTML = ACTION_BOARD_ICON_PATHS;
      return;
    }
    const svgMarker = icon(ACTION_BOARD_ICON_PATHS);
    normalizeActionBoardIconSvg(svgMarker);
    svgMarker.classList.add("codex-action-side-panel-entry__icon");
    root.prepend(svgMarker);
    return;
    const marker = document.createElement("span");
    marker.className = "codex-action-side-panel-entry__icon";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = "☑";
    root.prepend(marker);
  }

  function normalizeActionBoardIconSvg(svg) {
    svg.classList.add("codex-action-side-panel-entry__icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.75");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
  }

  function replaceShortcutText(root, value) {
    const candidates = Array.from(root.querySelectorAll("*")).filter((node) => {
      const text = node.textContent || "";
      if (!/\bCtrl\b/i.test(text)) return false;
      return !Array.from(node.children).some((child) => /\bCtrl\b/i.test(child.textContent || ""));
    });
    const target = candidates.at(-1);
    let replaced = false;
    if (target) {
      target.textContent = value;
      replaced = true;
    }
    if (replaced) return;
    const shortcut = document.createElement("span");
    shortcut.textContent = value;
    shortcut.setAttribute("aria-hidden", "true");
    root.append(shortcut);
  }

  function replaceFirstText(root, value) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let firstText = null;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.nodeValue.trim()) continue;
      if (/\bCtrl\b/i.test(node.nodeValue)) {
        node.nodeValue = "";
        continue;
      }
      if (!firstText) firstText = node;
      if (/Review|Terminal|Browser|Files|Side chat/i.test(node.nodeValue)) {
        node.nodeValue = value;
        return;
      }
    }
    if (firstText) firstText.nodeValue = value;
    else root.append(document.createTextNode(value));
  }

  function mountPanel() {
    const root = sidePanelRoot();
    if (root && root.contains(sidePanelEntry)) {
      if (panel.parentElement !== root) root.append(panel);
      panel.dataset.mode = "sidepanel";
      panel.dataset.placement = "right";
      panel.style.setProperty("--codex-ab-safe-top", "0px");
      return;
    }
    const desktopMain = document.querySelector('[class*="electron:"]') ? document.querySelector("main") : null;
    const dockHost = desktopMain?.parentElement;
    if (dockHost && getComputedStyle(dockHost).display === "flex") {
      if (panel.parentElement !== dockHost) dockHost.append(panel);
      panel.dataset.mode = "docked";
    } else {
      if (panel.parentElement !== document.body) document.body.append(panel);
      panel.dataset.mode = "overlay";
    }
    updatePanelPlacement();
  }

  function updatePanelPlacement() {
    if (!panel) return;
    if (panel.dataset.mode === "sidepanel") {
      panel.dataset.placement = "right";
      panel.style.setProperty("--codex-ab-safe-top", "0px");
      return;
    }
    if (panel.dataset.mode === "docked") {
      panel.dataset.placement = "right";
      panel.style.setProperty("--codex-ab-safe-top", "0px");
      return;
    }
    const visibleFrames = Array.from(document.querySelectorAll("iframe, webview"))
      .map((frame) => frame.getBoundingClientRect())
      .filter((rect) => rect.width >= 180 && rect.height >= 120);
    const rightSideOccupied = visibleFrames.some((rect) => (
      rect.left >= window.innerWidth / 2 && rect.right >= window.innerWidth - 8
    ));
    const isCodexDesktop = Boolean(document.querySelector('[class*="electron:"]'));
    panel.dataset.placement = isCodexDesktop || rightSideOccupied ? "left" : "right";
    panel.style.setProperty(
      "--codex-ab-safe-top",
      isCodexDesktop || navigator.userAgent.includes("Electron") ? "34px" : "0px"
    );
  }

  function selectedAssistantText() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const text = selection.toString().trim();
    if (!text) return null;
    const range = selection.getRangeAt(0);
    const commonNode = range.commonAncestorContainer?.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer?.parentElement;
    const anchorNode = selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement;
    const focusNode = selection.focusNode?.nodeType === Node.ELEMENT_NODE ? selection.focusNode : selection.focusNode?.parentElement;
    const response = commonNode?.closest?.(RESPONSE_SELECTOR)
      || anchorNode?.closest?.(RESPONSE_SELECTOR)
      || focusNode?.closest?.(RESPONSE_SELECTOR);
    if (!isAssistantResponse(response)) return null;
    const selectedListItem = commonTopLevelListItem(commonNode, anchorNode, focusNode, response);
    return { text, response, rect: visibleSelectionRect(range), fragment: range.cloneContents(), listItem: selectedListItem };
  }

  function visibleSelectionRect(range) {
    const bounding = range.getBoundingClientRect();
    if (bounding.width > 0 && bounding.height > 0) return bounding;
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    if (!rects.length) return bounding;
    return rects.reduce((best, rect) => (rect.right > best.right ? rect : best), rects[0]);
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function topLevelListItem(node, response) {
    let item = node?.closest?.("li");
    if (!item || !response?.contains(item)) return null;
    let parentItem = item.parentElement?.closest("li");
    while (parentItem && response.contains(parentItem)) {
      item = parentItem;
      parentItem = item.parentElement?.closest("li");
    }
    return item;
  }

  function commonTopLevelListItem(commonNode, anchorNode, focusNode, response) {
    const commonItem = topLevelListItem(commonNode, response);
    const anchorItem = topLevelListItem(anchorNode, response);
    const focusItem = topLevelListItem(focusNode, response);
    if (commonItem && (!anchorItem || commonItem === anchorItem) && (!focusItem || commonItem === focusItem)) return commonItem;
    if (anchorItem && anchorItem === focusItem) return anchorItem;
    return null;
  }

  function openFromShortcut() {
    if (!panel.hidden) {
      closeBoard();
      return;
    }
    const selected = selectedAssistantText();
    if (selected) {
      openBoard(selected.response, selected.text, selected.fragment, selected.listItem);
      window.getSelection()?.removeAllRanges();
      return;
    }
    const responses = Array.from(document.querySelectorAll("[data-codex-action-ready='true']"))
      .filter(isAssistantResponse);
    const latest = responses.at(-1);
    if (latest) openBoard(latest);
    else openBoard(null);
  }

  function isActionBoardShortcut(event) {
    return event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey && event.key.toLowerCase() === "l";
  }

  function setup() {
    const surfaces = [document.querySelector("main"), document.body, document.documentElement].filter(Boolean);
    const background = surfaces.map((element) => getComputedStyle(element).backgroundColor)
      .find((color) => color && color !== "transparent" && !/rgba\([^)]*,\s*0\s*\)$/.test(color));
    const foreground = surfaces.map((element) => getComputedStyle(element).color).find(Boolean);
    if (background) document.documentElement.style.setProperty("--codex-ab-host-bg", background);
    else document.documentElement.style.removeProperty("--codex-ab-host-bg");
    if (foreground) document.documentElement.style.setProperty("--codex-ab-host-fg", foreground);

    panel = document.createElement("aside");
    panel.hidden = true;
    panel.className = "codex-action-board";
    panel.dataset.codexActionBoard = "true";
    panel.setAttribute("aria-labelledby", "codex-action-board-title");

    liveRegion = document.createElement("div");
    liveRegion.className = "codex-action-sr-only";
    liveRegion.setAttribute("aria-live", "polite");

    selectionTrigger = button(
      "فتح التحديد في لوحة الإجراءات",
      "codex-action-selection-trigger",
      openSelectedText,
      ACTION_BOARD_ICON_PATHS
    );
    selectionTrigger.hidden = true;

    document.body.append(panel);
    mountPanel();
    document.body.append(liveRegion);
    document.body.append(selectionTrigger);
    updatePanelPlacement();
    scanResponses();
    setupExtensionMessages();
    window.__CODEX_ACTION_BOARD_OPEN_CONTEXT__ = runPendingContextAction;

    document.addEventListener("contextmenu", showContextMenu, { signal: eventController.signal });
    document.addEventListener("selectionchange", scheduleSelectionTrigger, { signal: eventController.signal });
    document.addEventListener("mouseup", scheduleSelectionTrigger, { signal: eventController.signal });
    document.addEventListener("keyup", (event) => {
      scheduleSelectionTrigger();
      if (event.key === "Escape" && !panel.hidden) closeBoard();
      if (event.key === "Escape") hideSelectionTrigger();
    }, { signal: eventController.signal });
    document.addEventListener("keydown", (event) => {
      if (!isActionBoardShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      openFromShortcut();
    }, { signal: eventController.signal });
    window.addEventListener("resize", () => {
      updatePanelPlacement();
      hideSelectionTrigger();
    }, { signal: eventController.signal });
    document.addEventListener("scroll", hideSelectionTrigger, { capture: true, signal: eventController.signal });

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE && !node.closest?.("[data-codex-action-board]")) scanResponses(node);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.__CODEX_ACTION_BOARD_OBSERVER__ = observer;
    window.__CODEX_ACTION_BOARD_ACTIVE__ = true;
  }

  setup();
})();
