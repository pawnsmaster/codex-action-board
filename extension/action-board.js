(function codexActionBoard() {
  "use strict";

  if (window.__CODEX_ACTION_BOARD_ACTIVE__) {
    window.__CODEX_ACTION_BOARD_OBSERVER__?.disconnect();
    window.__CODEX_ACTION_BOARD_EVENTS__?.abort();
    clearInterval(window.__CODEX_ACTION_BOARD_SCAN_INTERVAL__);
    delete window.__CODEX_ACTION_BOARD_SCAN_INTERVAL__;
    delete window.__CODEX_ACTION_BOARD_OPEN_CONTEXT__;
    document.querySelectorAll(
      ".codex-action-board, .codex-action-trigger, .codex-action-composer-trigger, .codex-action-side-panel-entry, .codex-action-sr-only, .codex-action-selection-trigger, .codex-action-context-menu, .codex-action-native-menu-item"
    ).forEach((element) => element.remove());
    document.querySelectorAll("[data-codex-action-ready]").forEach((element) => delete element.dataset.codexActionReady);
  }
  const core = window.__CODEX_ACTION_BOARD_CORE__;
  if (!core) throw new Error("Action Board core was not loaded.");

  const LANGUAGE_KEY = "codex-action-board-language";
  const COPY = {
    ar: {
      title: "لوحة الإجراءات", open: "فتح لوحة الإجراءات", openSelection: "فتح التحديد في لوحة الإجراءات",
      openResponse: "فتح في لوحة الإجراءات", close: "إغلاق اللوحة", acceptAll: "قبول الكل", reset: "إعادة التعيين",
      resetAria: "إعادة تعيين الحالات", accept: "قبول", reject: "رفض", later: "لاحقًا", statusAria: "حالة العنصر",
      moveUp: "تحريك لأعلى", moveDown: "تحريك لأسفل", actionText: "نص الإجراء",
      note: "ملاحظة أو توجيه (اختياري)", notePlaceholder: "مثال: حافظ على التصميم الحالي",
      accepted: "مقبول", rejected: "مرفوض", undecided: "غير محسوم", preview: "معاينة الرسالة",
      insert: "إدراج في مربع الكتابة", insertAria: "إدراج في مربع كتابة Codex",
      group: "ضم النقاط الفرعية داخل قرار واحد", split: "تفصيل النقاط الفرعية كقرارات منفصلة",
      empty: "لم نجد قائمة قابلة للتحويل في هذا الرد. حدّد نصًا وأضفه إلى اللوحة.", switchLanguage: "Switch to English",
      switched: "تم تغيير لغة الأداة إلى العربية وتفعيل RTL.", composerMissing: "تعذّر العثور على مربع كتابة Codex.",
      composerMissingHelp: "تعذّر العثور على مربع الكتابة. اترك المحادثة مفتوحة وحاول مجددًا.",
      inserted: "تم إدراج القرارات في مربع الكتابة دون إرسالها.",
      splitDone: "تم تفصيل النقاط الفرعية كقرارات منفصلة.", groupedDone: "تم ضم النقاط الفرعية داخل قرار واحد.",
      opened: (count) => `فُتحت لوحة الإجراءات وبها ${count} عناصر.`
    },
    en: {
      title: "Action Board", open: "Open Action Board", openSelection: "Open selection in Action Board",
      openResponse: "Open in Action Board", close: "Close Action Board", acceptAll: "Accept all", reset: "Reset",
      resetAria: "Reset all decisions", accept: "Accept", reject: "Reject", later: "Later", statusAria: "Item status",
      moveUp: "Move up", moveDown: "Move down", actionText: "Action text",
      note: "Note or guidance (optional)", notePlaceholder: "Example: Keep the current design",
      accepted: "accepted", rejected: "rejected", undecided: "undecided", preview: "Message preview",
      insert: "Insert into composer", insertAria: "Insert into the Codex composer",
      group: "Group sub-items into one decision", split: "Split sub-items into separate decisions",
      empty: "No actionable list was found in this response. Select text and add it to the board.", switchLanguage: "التبديل إلى العربية",
      switched: "Action Board switched to English. Codex RTL has been disabled.", composerMissing: "The Codex composer could not be found.",
      composerMissingHelp: "The composer could not be found. Keep the conversation open and try again.",
      inserted: "The decisions were inserted into the composer without being sent.",
      splitDone: "Sub-items are now separate decisions.", groupedDone: "Sub-items are now grouped into one decision.",
      opened: (count) => `Action Board opened with ${count} items.`
    }
  };

  function loadLanguage() {
    try {
      const stored = localStorage.getItem(LANGUAGE_KEY);
      if (stored === "ar" || stored === "en") return stored;
    } catch {}
    return window.__CODEX_ACTION_BOARD_LANGUAGE__ === "ar" ? "ar" : "en";
  }

  const RESPONSE_SELECTOR = [
    "[data-codex-assistant-response='true']",
    "[data-message-author-role='assistant' i]",
    "article[data-testid*='assistant' i]"
  ].join(",");
  const state = {
    sourceText: "",
    items: [],
    sourceElement: null,
    sourceContext: null,
    returnFocus: null,
    language: loadLanguage(),
    subitemMode: "grouped",
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

  function copy(key) { return COPY[state.language][key]; }

  function applyUiDirection(element, align) {
    const rtl = state.language === "ar";
    element.dir = rtl ? "rtl" : "ltr";
    element.style.setProperty("direction", rtl ? "rtl" : "ltr", "important");
    element.style.setProperty("text-align", align || (rtl ? "right" : "left"), "important");
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
    const explicitlyAssistant = el.dataset.codexAssistantResponse === "true"
      || el.matches("[data-message-author-role='assistant' i]")
      || el.matches("article[data-testid*='assistant' i]");
    if (!explicitlyAssistant) return false;
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
    const preferredLeft = state.language === "ar" ? rect.left - size - gap : rect.right + gap;
    const left = clamp(preferredLeft, minLeft, maxLeft);
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
    if (!isAssistantResponse(el)) return;
    if (el.dataset.codexActionReady) {
      const existingTrigger = el.querySelector(".codex-action-trigger");
      if (existingTrigger?.isConnected) return;
      delete el.dataset.codexActionReady;
    }
    el.dataset.codexActionReady = "true";
    const trigger = button(
      copy("openResponse"),
      "codex-action-trigger",
      () => openBoard(el),
      ACTION_BOARD_ICON_PATHS
    );
    trigger.removeAttribute("title");
    const actionRow = findActionRow(el);
    if (actionRow) {
      trigger.classList.add("codex-action-trigger--native");
      actionRow.append(trigger);
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
    announce(copy("opened")(state.items.length));
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
    announce(state.subitemMode === "split" ? copy("splitDone") : copy("groupedDone"));
  }

  function toggleLanguage() {
    const list = panel.querySelector(".codex-action-board__list");
    const scrollTop = list?.scrollTop || 0;
    state.language = state.language === "ar" ? "en" : "ar";
    window.__CODEX_ACTION_BOARD_LANGUAGE__ = state.language;
    try { localStorage.setItem(LANGUAGE_KEY, state.language); } catch {}
    globalThis.chrome?.runtime?.sendMessage?.({ type: "codex-action-board:set-language", language: state.language }, () => {
      void globalThis.chrome?.runtime?.lastError;
    });
    if (state.language === "ar") window.__CODEX_RTL_ENABLE__?.();
    else window.__CODEX_RTL_DISABLE__?.();
    renderPanel({ scrollTop });
    refreshLocalizedTriggers();
    announce(copy("switched"));
  }

  function refreshLocalizedTriggers() {
    document.querySelectorAll(".codex-action-trigger").forEach((trigger) => {
      trigger.setAttribute("aria-label", copy("openResponse"));
      trigger.removeAttribute("title");
    });
    if (selectionTrigger) {
      selectionTrigger.title = copy("openSelection");
      selectionTrigger.setAttribute("aria-label", copy("openSelection"));
    }
    const composerTrigger = document.querySelector(".codex-action-composer-trigger");
    if (composerTrigger) {
      composerTrigger.title = copy("open");
      composerTrigger.setAttribute("aria-label", copy("open"));
    }
    if (sidePanelEntry) {
      sidePanelEntry.title = copy("open");
      sidePanelEntry.setAttribute("aria-label", copy("open"));
      replaceFirstText(sidePanelEntry, copy("title"));
    }
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
    applyUiDirection(row);
    row.className = "codex-action-item";
    row.dataset.itemId = item.id;
    row.dataset.status = item.status;

    const top = document.createElement("div");
    applyUiDirection(top);
    top.className = "codex-action-item__top";
    const number = document.createElement("span");
    number.className = "codex-action-item__number";
    number.textContent = String(index + 1);
    number.setAttribute("aria-hidden", "true");
    const statuses = document.createElement("div");
    applyUiDirection(statuses);
    statuses.className = "codex-action-item__statuses";
    statuses.setAttribute("aria-label", copy("statusAria"));
    statuses.append(statusButton(item, "accepted", copy("accept")), statusButton(item, "rejected", copy("reject")), statusButton(item, "undecided", copy("later")));
    const moves = document.createElement("div");
    moves.className = "codex-action-item__moves";
    const up = button(copy("moveUp"), "codex-action-item__move", () => moveItem(item.id, -1), '<path d="m6 15 6-6 6 6"/>');
    up.disabled = index === 0;
    const down = button(copy("moveDown"), "codex-action-item__move", () => moveItem(item.id, 1), '<path d="m6 9 6 6 6-6"/>');
    down.disabled = index === state.items.length - 1;
    moves.append(up, down);
    top.append(number, statuses, moves);

    const label = document.createElement("label");
    applyUiDirection(label);
    label.className = "codex-action-item__label";
    label.textContent = copy("actionText");
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
    applyUiDirection(noteLabel);
    noteLabel.className = "codex-action-item__note-label";
    noteLabel.textContent = copy("note");
    const note = document.createElement("textarea");
    note.rows = 1;
    note.value = item.note;
    note.placeholder = copy("notePlaceholder");
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
      [count.accepted, copy("accepted")],
      [count.rejected, copy("rejected")],
      [count.undecided, copy("undecided")]
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
      text.dir = state.language === "ar" ? "rtl" : "ltr";
      text.textContent = label;
      stat.append(number, document.createTextNode(" "), text);
      summary.append(stat);
    });
    summary.setAttribute("aria-label", `${count.accepted} ${copy("accepted")}, ${count.rejected} ${copy("rejected")}, ${count.undecided} ${copy("undecided")}`);
    panel.querySelector(".codex-action-board__insert").disabled = count.accepted === 0;
    const preview = panel.querySelector(".codex-action-board__preview pre");
    if (preview) preview.textContent = core.formatPrompt(state.items, state.language);
  }

  function insertIntoComposer() {
    const prompt = core.formatPrompt(state.items, state.language);
    const composer = Array.from(document.querySelectorAll("textarea, [contenteditable='true'], [role='textbox']"))
      .find((el) => !el.closest("[data-codex-action-board]") && el.getClientRects().length);
    if (!composer) {
      announce(copy("composerMissing"));
      panel.dataset.error = "composer";
      renderError(copy("composerMissingHelp"));
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
    announce(copy("inserted"));
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
    applyUiDirection(panel);
    panel.dataset.language = state.language;
    const header = document.createElement("header");
    header.className = "codex-action-board__header";
    const headingWrap = document.createElement("div");
    applyUiDirection(headingWrap);
    const heading = document.createElement("h2");
    applyUiDirection(heading);
    heading.id = "codex-action-board-title";
    heading.textContent = copy("title");
    const summary = document.createElement("p");
    applyUiDirection(summary);
    summary.className = "codex-action-board__summary";
    headingWrap.append(heading, summary);
    const close = button(copy("close"), "codex-action-board__close", closeBoard, '<path d="m6 6 12 12M18 6 6 18"/>');
    header.append(headingWrap, close);

    const bulk = document.createElement("div");
    applyUiDirection(bulk);
    bulk.className = "codex-action-board__bulk";
    const acceptAll = button(copy("acceptAll"), "codex-action-board__bulk-button", () => {
      setAllStatuses("accepted");
    });
    acceptAll.textContent = copy("acceptAll");
    const clear = button(copy("resetAria"), "codex-action-board__bulk-button", () => {
      setAllStatuses("undecided");
    });
    clear.textContent = copy("reset");
    const language = button(copy("switchLanguage"), "codex-action-board__language", toggleLanguage);
    language.textContent = state.language === "ar" ? "EN" : "عربي";
    const subitemToggle = button(
      state.subitemMode === "split" ? copy("group") : copy("split"),
      "codex-action-board__mode-toggle",
      toggleSubitemMode,
      state.subitemMode === "split"
        ? '<path d="M8 7h11M8 12h11M8 17h11"/><path d="M4 7h.01M4 12h.01M4 17h.01"/>'
        : '<path d="M8 6h11M8 18h11"/><path d="M11 10h8M11 14h8"/><path d="M4 6h.01M4 18h.01"/><path d="M7 10h.01M7 14h.01"/>'
    );
    subitemToggle.setAttribute("aria-pressed", String(state.subitemMode === "grouped"));
    subitemToggle.dataset.mode = state.subitemMode;
    bulk.append(acceptAll, clear, language, subitemToggle);

    const list = document.createElement("ol");
    applyUiDirection(list);
    list.className = "codex-action-board__list";
    if (state.items.length) state.items.forEach((item, index) => list.append(renderItem(item, index)));
    else {
      const empty = document.createElement("li");
      empty.className = "codex-action-board__empty";
      empty.textContent = copy("empty");
      list.append(empty);
    }

    const preview = document.createElement("details");
    applyUiDirection(preview);
    preview.className = "codex-action-board__preview";
    const previewSummary = document.createElement("summary");
    applyUiDirection(previewSummary);
    previewSummary.textContent = copy("preview");
    const output = document.createElement("pre");
    applyUiDirection(output);
    output.textContent = core.formatPrompt(state.items, state.language);
    preview.append(previewSummary, output);

    const footer = document.createElement("footer");
    applyUiDirection(footer);
    footer.className = "codex-action-board__footer";
    const insert = button(copy("insertAria"), "codex-action-board__insert", insertIntoComposer);
    applyUiDirection(insert, "center");
    insert.textContent = copy("insert");
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
    const trigger = button(copy("open"), "codex-action-composer-trigger", () => openBoard(null), ACTION_BOARD_ICON_PATHS);
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
    sidePanelEntry.title = copy("open");
    sidePanelEntry.setAttribute("aria-label", copy("open"));
    replaceShortcutText(sidePanelEntry, "Ctrl+Alt+L");
    replaceSidePanelIcon(sidePanelEntry);
    replaceFirstText(sidePanelEntry, copy("title"));
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
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    if (!rects.length) return bounding;
    const firstLine = rects.reduce((best, rect) => (
      rect.top < best.top || (Math.abs(rect.top - best.top) <= 1 && rect.left < best.left) ? rect : best
    ), rects[0]);
    return {
      left: Math.min(...rects.map((rect) => rect.left)),
      right: Math.max(...rects.map((rect) => rect.right)),
      top: firstLine.top,
      bottom: firstLine.bottom,
      width: Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left)),
      height: firstLine.height
    };
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
    window.__CODEX_ACTION_BOARD_LANGUAGE__ = state.language;
    if (state.language === "ar") window.__CODEX_RTL_ENABLE__?.();
    else window.__CODEX_RTL_DISABLE__?.();
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
      copy("openSelection"),
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
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) scanResponses();
    }, { signal: eventController.signal });
    window.addEventListener("focus", () => scanResponses(), { signal: eventController.signal });

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE && !node.closest?.("[data-codex-action-board]")) scanResponses(node);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.__CODEX_ACTION_BOARD_OBSERVER__ = observer;
    window.__CODEX_ACTION_BOARD_SCAN_INTERVAL__ = setInterval(() => {
      if (!document.hidden) scanResponses();
    }, 1500);
    window.__CODEX_ACTION_BOARD_ACTIVE__ = true;
  }

  setup();
})();
