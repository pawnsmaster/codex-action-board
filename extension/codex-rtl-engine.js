(function codexRtlEngine() {
  const STYLE_ID = "codex-action-board-style";
  const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const LATIN_RE = /[A-Za-z]/;
  let processed = new WeakMap();
  const pending = new Set();
  let scheduled = false;
  const BLOCK_SELECTOR = [
    "article",
    "[data-message-author-role]",
    "[data-testid*='message']",
    "[class*='message' i]",
    "[class*='markdown' i]",
    "[class*='whitespace-pre-wrap' i]",
    "main p",
    "main li",
    "main blockquote"
  ].join(",");
  const TEXT_LEAF_SELECTOR = [
    "[data-message-author-role='user' i] div",
    "[data-message-author-role='user' i] span",
    "[data-message-author-role='user' i] p",
    "[data-testid*='message' i] div",
    "[data-testid*='message' i] span",
    "[class*='whitespace-pre-wrap' i]",
    "[class*='break-words' i]",
    "[class*='text-message' i]"
  ].join(",");
  const INTERACTIVE_SELECTOR = [
    "textarea",
    "input",
    "[contenteditable='true']",
    "[role='textbox']",
    "form",
    "[data-testid*='composer' i]",
    "[class*='composer' i]",
    "[class*='prompt' i]"
  ].join(",");
  const CODE_BLOCK_SELECTOR = [
    "pre",
    "code",
    "kbd",
    "samp",
    "[data-testid*='code' i]",
    "[class*='code' i]",
    "[class*='highlight' i]",
    "[class*='shiki' i]",
    "[class*='terminal' i]",
    "[class*='monaco' i]"
  ].join(",");

  function ensureStyle() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.documentElement.appendChild(style);
    }
    style.textContent = window.__CODEX_RTL_STYLE__ || "";
  }

  function cleanupRtl() {
    window.__CODEX_RTL_OBSERVER__?.disconnect();
    delete window.__CODEX_RTL_OBSERVER__;
    pending.clear();
    scheduled = false;
    if (!window.__CODEX_RTL_ACTIVE__ && !document.documentElement.dataset.codexRtlRoot) {
      window.__CODEX_RTL_ACTIVE__ = false;
      return;
    }

    const normalize = new Set();
    document.querySelectorAll("[data-codex-ltr-run]").forEach((run) => {
      if (run.parentNode) normalize.add(run.parentNode);
      run.replaceWith(document.createTextNode(run.textContent || ""));
    });
    normalize.forEach((parent) => parent.normalize());

    document.querySelectorAll("[data-codex-markdown-rtl]").forEach((element) => {
      restoreDir(element);
      delete element.dataset.codexMarkdownRtl;
    });
    document.querySelectorAll("[data-codex-code-ltr]").forEach((element) => {
      restoreDir(element);
      delete element.dataset.codexCodeLtr;
    });
    document.querySelectorAll("[data-codex-rtl]").forEach((element) => {
      restoreDir(element);
      delete element.dataset.codexRtl;
    });
    document.querySelectorAll("[data-codex-bidi]").forEach((element) => {
      restoreDir(element);
      delete element.dataset.codexBidi;
    });
    document.querySelectorAll("[data-codex-markdown]").forEach((element) => delete element.dataset.codexMarkdown);
    delete document.documentElement.dataset.codexRtlRoot;
    processed = new WeakMap();
    window.__CODEX_RTL_ACTIVE__ = false;
  }

  function rememberDir(el) {
    if (!el || Object.hasOwn(el.dataset, "codexPrevDir")) return;
    el.dataset.codexPrevDir = el.hasAttribute("dir") ? el.getAttribute("dir") : "";
  }

  function restoreDir(el) {
    if (!el) return;
    if (Object.hasOwn(el.dataset, "codexPrevDir")) {
      const previous = el.dataset.codexPrevDir;
      if (previous) el.setAttribute("dir", previous);
      else el.removeAttribute("dir");
      delete el.dataset.codexPrevDir;
      return;
    }
    if (el.matches("[data-codex-rtl], [data-codex-markdown-rtl]") && el.getAttribute("dir") === "rtl") el.removeAttribute("dir");
    if (el.matches("[data-codex-bidi]") && el.getAttribute("dir") === "auto") el.removeAttribute("dir");
    if (el.matches("[data-codex-code-ltr]") && el.getAttribute("dir") === "ltr") el.removeAttribute("dir");
  }

  function isCodeLike(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    return Boolean(node.closest(`${CODE_BLOCK_SELECTOR}, textarea, input, [role='textbox']`));
  }

  function isInteractive(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    return Boolean(node.closest(INTERACTIVE_SELECTOR));
  }

  function classifyText(text) {
    const hasArabic = ARABIC_RE.test(text);
    if (!hasArabic) return "auto";
    const arabicCount = (text.match(new RegExp(ARABIC_RE.source, "g")) || []).length;
    const latinCount = (text.match(/[A-Za-z]/g) || []).length;
    return arabicCount >= Math.max(2, latinCount * 0.25) ? "rtl" : "auto";
  }

  function applyDirection(el) {
    if (!el || isCodeLike(el) || isInteractive(el)) return;
    const text = (el.innerText || el.textContent || "").trim();
    if (!text) return;
    if (processed.get(el) === text) return;
    processed.set(el, text);

    const direction = classifyText(text);
    if (direction === "rtl") {
      rememberDir(el);
      el.dataset.codexRtl = "true";
      el.dir = "rtl";
    } else if (ARABIC_RE.test(text) && LATIN_RE.test(text)) {
      el.dataset.codexBidi = "auto";
      if (!el.getAttribute("dir")) {
        rememberDir(el);
        el.dir = "auto";
      }
    }
  }

  function hasDirectText(el) {
    return Array.from(el.childNodes).some((node) => (
      node.nodeType === Node.TEXT_NODE && ARABIC_RE.test(node.textContent || "")
    ));
  }

  function applyTextLeafDirection(el) {
    if (!el || isCodeLike(el) || isInteractive(el) || !hasDirectText(el)) return;
    applyDirection(el);
  }

  function isolateLatinRuns(el) {
    if (!el?.dataset.codexRtl || isCodeLike(el) || isInteractive(el)) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let node;

    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest(`${CODE_BLOCK_SELECTOR}, [data-codex-ltr-run], ${INTERACTIVE_SELECTOR}`)) continue;
      if (LATIN_RE.test(node.textContent || "")) textNodes.push(node);
    }

    const latinRun = /[A-Za-z][A-Za-z0-9._:/\\+@#-]*(?:\s+[A-Za-z][A-Za-z0-9._:/\\+@#-]*)*/g;
    for (const textNode of textNodes) {
      const text = textNode.textContent || "";
      const matches = Array.from(text.matchAll(latinRun));
      if (matches.length === 0) continue;

      const fragment = document.createDocumentFragment();
      let offset = 0;
      for (const match of matches) {
        const index = match.index || 0;
        fragment.append(text.slice(offset, index));
        const trailingPunctuation = match[0].match(/[.,;:!?]+$/)?.[0] || "";
        const latinText = trailingPunctuation
          ? match[0].slice(0, -trailingPunctuation.length)
          : match[0];
        const bdi = document.createElement("bdi");
        bdi.dir = "ltr";
        bdi.dataset.codexLtrRun = "true";
        bdi.textContent = latinText;
        fragment.append(bdi);
        fragment.append(trailingPunctuation);
        offset = index + match[0].length;
      }
      fragment.append(text.slice(offset));
      textNode.replaceWith(fragment);
    }
  }

  function applyMarkdownCodeDirection(code) {
    if (!code?.querySelector(".hljs-bullet, .hljs-section, .hljs-strong, .hljs-emphasis")) return;
    const lineContainer = code.firstElementChild;
    if (!lineContainer) return;
    code.dataset.codexMarkdown = "true";

    for (const line of lineContainer.children) {
      if (!ARABIC_RE.test(line.textContent || "")) continue;
      rememberDir(line);
      line.dir = "rtl";
      line.dataset.codexMarkdownRtl = "true";
    }
  }

  function scan(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE || isInteractive(root)) return;
    root.querySelectorAll?.(CODE_BLOCK_SELECTOR).forEach((el) => {
      rememberDir(el);
      el.dir = "ltr";
      el.dataset.codexCodeLtr = "true";
    });
    if (root.matches && root.matches("code")) applyMarkdownCodeDirection(root);
    root.querySelectorAll?.("code").forEach(applyMarkdownCodeDirection);
    if (root.matches && root.matches(BLOCK_SELECTOR)) applyDirection(root);
    root.querySelectorAll?.(BLOCK_SELECTOR).forEach(applyDirection);
    if (root.matches && root.matches(TEXT_LEAF_SELECTOR)) applyTextLeafDirection(root);
    root.querySelectorAll?.(TEXT_LEAF_SELECTOR).forEach(applyTextLeafDirection);
    if (root.matches && root.matches("[data-codex-rtl='true']")) isolateLatinRuns(root);
    root.querySelectorAll?.("[data-codex-rtl='true']").forEach(isolateLatinRuns);
  }

  function scheduleScan(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE || isInteractive(root)) return;
    pending.add(root);
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const batch = Array.from(pending).slice(0, 25);
      pending.clear();
      batch.forEach(scan);
    });
  }

  function enableRtl() {
    ensureStyle();
    document.documentElement.dataset.codexRtlRoot = "true";
    scan(document.body);
    window.__CODEX_RTL_OBSERVER__?.disconnect();
    window.__CODEX_RTL_OBSERVER__ = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) scheduleScan(node);
      }
    });
    window.__CODEX_RTL_OBSERVER__.observe(document.body, { childList: true, subtree: true });
    window.__CODEX_RTL_ACTIVE__ = true;
  }

  window.__CODEX_RTL_ENABLE__ = enableRtl;
  window.__CODEX_RTL_DISABLE__ = cleanupRtl;

  let language = window.__CODEX_ACTION_BOARD_LANGUAGE__;
  try { language ||= localStorage.getItem("codex-action-board-language"); } catch {}
  ensureStyle();
  if (language === "ar") enableRtl();
  else cleanupRtl();
})();
