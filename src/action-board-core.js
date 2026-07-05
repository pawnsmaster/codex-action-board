(function exposeActionBoardCore(global) {
  "use strict";

  const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)]|\[(?: |x|X)\])\s+(.+)$/;
  const HEADING_RE = /^\s{0,3}#{1,6}\s+(.+)$/;
  const SEMANTIC_LINE_RE = /^\s*(?:[-*+]|\d+[.)]|\[(?: |x|X)\])\s+/;

  function clean(text) {
    return String(text || "")
      .replace(/^\s*\[(?: |x|X)\]\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeActionText(text) {
    const lines = String(text || "")
      .replace(/^\s*\[(?: |x|X)\]\s*/, "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/g, ""));
    const normalized = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (normalized.at(-1) !== "") normalized.push("");
        continue;
      }
      if (!normalized.length || SEMANTIC_LINE_RE.test(line) || normalized.at(-1) === "") {
        normalized.push(SEMANTIC_LINE_RE.test(line) ? line.trimEnd() : trimmed);
        continue;
      }
      normalized[normalized.length - 1] = joinSoftWrappedLine(normalized.at(-1), trimmed);
    }
    return normalized.join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function joinSoftWrappedLine(previous, next) {
    const leading = previous.match(/^\s*/)?.[0] || "";
    const body = previous.slice(leading.length);
    return leading + `${body} ${next}`
      .replace(/\s+([،,.;:!?؟])/g, "$1")
      .replace(/([([{«])\s+/g, "$1")
      .replace(/\s+([)\]}»])/g, "$1")
      .replace(/\s{2,}/g, " ");
  }

  function createItem(text, order, status = "undecided") {
    const value = normalizeActionText(text);
    return {
      id: `action-${Date.now().toString(36)}-${order}-${Math.random().toString(36).slice(2, 7)}`,
      originalText: value,
      editedText: value,
      status,
      note: "",
      priority: undefined,
      order
    };
  }

  function parseText(sourceText) {
    const lines = String(sourceText || "").replace(/\r\n?/g, "\n").split("\n");
    const listItems = [];
    let current = null;
    let inFence = false;

    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const match = line.match(LIST_ITEM_RE);
      if (match && clean(match[3])) {
        const indent = match[1].replace(/\t/g, "    ").length;
        const checked = /^\s*(?:[-*+]\s+)?\[[xX]\]/.test(line);
        if (current && indent > current.indent) {
          current.lines.push(`${"  ".repeat(Math.max(1, Math.floor((indent - current.indent) / 2)))}- ${match[3].trim()}`);
          continue;
        }
        current = {
          indent,
          lines: [match[3].trim()],
          status: checked ? "accepted" : "undecided"
        };
        listItems.push(current);
        continue;
      }
      if (current && line.trim()) {
        current.lines.push(line.trim());
      }
    }

    if (listItems.length) {
      return listItems.map((item, index) => createItem(item.lines.join("\n"), index, item.status));
    }

    const blocks = String(sourceText || "")
      .replace(/```[\s\S]*?```/g, "")
      .split(/\n\s*\n/)
      .map((block) => clean(block.replace(HEADING_RE, "$1")))
      .filter((block) => block.length >= 8 && block.length <= 600);

    return blocks.map((block, index) => createItem(block, index));
  }

  const PROMPT_COPY = {
    ar: {
      groups: { accepted: "المطلوب تنفيذه", rejected: "مستبعد — لا تنفّذ", undecided: "مؤجّل — لا تنفّذ" },
      intro: "طبّق القرارات التالية على ردك السابق. هذه القائمة هي المرجع النهائي؛ إذا تعارضت مع أي اقتراح سابق، اتبعها هي.",
      directive: "توجيه ملزم",
      priority: "الأولوية",
      method: "طريقة التنفيذ",
      rules: [
        "نفّذ عناصر «المطلوب تنفيذه» فقط، وبالترتيب الموضح.",
        "التزم بالنص الحالي والتوجيهات الملحقة بكل عنصر، ولا توسّع نطاقه من عندك.",
        "لا تنفّذ العناصر المستبعدة أو المؤجلة، ولا تستبدلها ببدائل.",
        "ابدأ بخطة قصيرة ثم نفّذ مباشرة. اسأل فقط إذا تعذّر التنفيذ أو احتجت قرارًا غير موجود هنا.",
        "بعد الانتهاء، لخّص ما نُفّذ والفحوص التي أجريتها."
      ]
    },
    en: {
      groups: { accepted: "Implement", rejected: "Excluded — do not implement", undecided: "Deferred — do not implement" },
      intro: "Apply the following decisions to your previous response. This list is the final source of truth; if it conflicts with an earlier suggestion, follow this list.",
      directive: "Required guidance",
      priority: "Priority",
      method: "Execution instructions",
      rules: [
        "Implement only the items under “Implement”, in the order shown.",
        "Follow each item's current wording and attached guidance; do not expand its scope.",
        "Do not implement excluded or deferred items, and do not replace them with alternatives.",
        "Start with a short plan, then implement directly. Ask only if implementation is blocked or requires a decision not provided here.",
        "When finished, summarize what you implemented and the checks you ran."
      ]
    }
  };

  function formatPrompt(items, language = "ar") {
    const copy = PROMPT_COPY[language] || PROMPT_COPY.ar;
    const ordered = [...(items || [])].sort((a, b) => a.order - b.order);
    const groups = [
      ["accepted", copy.groups.accepted],
      ["rejected", copy.groups.rejected],
      ["undecided", copy.groups.undecided]
    ];
    const sections = [copy.intro];

    for (const [status, title] of groups) {
      const group = ordered.filter((item) => item.status === status);
      if (!group.length) continue;
      sections.push(`## ${title}`);
      group.forEach((item, index) => {
        const text = normalizeActionText(item.editedText || item.originalText);
        sections.push(`${index + 1}. ${text.replace(/\n/g, "\n   ")}`);
        if (item.note?.trim()) sections.push(`   - ${copy.directive}: ${normalizeActionText(item.note).replace(/\n/g, "\n     ")}`);
        if (item.priority) sections.push(`   ${copy.priority}: ${item.priority}`);
      });
    }

    sections.push(
      `## ${copy.method}`,
      copy.rules.map((rule) => `- ${rule}`).join("\n")
    );
    return sections.join("\n\n");
  }

  global.__CODEX_ACTION_BOARD_CORE__ = { clean, normalizeActionText, createItem, parseText, formatPrompt };
})(typeof window !== "undefined" ? window : globalThis);
