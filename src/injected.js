(function codexRtlToolkit() {
  const STYLE_ID = "codex-rtl-toolkit-style";
  const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const LATIN_RE = /[A-Za-z]/;
  const processed = new WeakMap();
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
    document.documentElement.dataset.codexRtlRoot = "true";
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
      el.dataset.codexRtl = "true";
      el.dir = "rtl";
    } else if (ARABIC_RE.test(text) && LATIN_RE.test(text)) {
      el.dataset.codexBidi = "auto";
      if (!el.getAttribute("dir")) el.dir = "auto";
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

  function scan(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE || isInteractive(root)) return;
    root.querySelectorAll?.(CODE_BLOCK_SELECTOR).forEach((el) => {
      el.dir = "ltr";
      el.dataset.codexCodeLtr = "true";
    });
    if (root.matches && root.matches(BLOCK_SELECTOR)) applyDirection(root);
    root.querySelectorAll?.(BLOCK_SELECTOR).forEach(applyDirection);
    if (root.matches && root.matches(TEXT_LEAF_SELECTOR)) applyTextLeafDirection(root);
    root.querySelectorAll?.(TEXT_LEAF_SELECTOR).forEach(applyTextLeafDirection);
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

  ensureStyle();
  scan(document.body);

  if (window.__CODEX_RTL_OBSERVER__) {
    window.__CODEX_RTL_OBSERVER__.disconnect();
  }

  window.__CODEX_RTL_OBSERVER__ = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) scheduleScan(node);
    }
  });

  window.__CODEX_RTL_OBSERVER__.observe(document.body, {
    childList: true,
    subtree: true
  });

  window.__CODEX_RTL_ACTIVE__ = true;
})();
