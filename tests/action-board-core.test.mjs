import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/action-board-core.js", import.meta.url), "utf8");
const context = { globalThis: {}, Date, Math };
vm.runInNewContext(source, context);
const core = context.globalThis.__CODEX_ACTION_BOARD_CORE__;

test("parses numbered, bulleted, and checked Markdown outside code fences", () => {
  const items = core.parseText("1. First\n- Second\n[x] Third\n```\n- ignored\n```");
  assert.deepEqual(Array.from(items, (item) => item.originalText), ["First", "Second", "Third"]);
  assert.equal(items[2].status, "accepted");
});

test("keeps nested bullets inside their parent numbered action", () => {
  const items = core.parseText([
    "1. Unify the right-click menu",
    "   - Open item card",
    "   - Copy item number",
    "2. Keep dangerous actions visible but separated"
  ].join("\n"));

  assert.equal(items.length, 2);
  assert.equal(items[0].originalText, "Unify the right-click menu\n  - Open item card\n  - Copy item number");
  assert.equal(items[1].originalText, "Keep dangerous actions visible but separated");
});

test("joins visual soft wraps inside one action line", () => {
  assert.equal(
    core.normalizeActionText("يظهر عند تحديد نص داخل رد\nassistant\n."),
    "يظهر عند تحديد نص داخل رد assistant."
  );
  assert.equal(
    core.normalizeActionText("يختفي عند فتح اللوحة، أو\nscroll\n، أو\nEscape\n."),
    "يختفي عند فتح اللوحة، أو scroll، أو Escape."
  );
});

test("keeps real nested bullet lines while joining wrapped bullet text", () => {
  assert.equal(
    core.normalizeActionText("الأب:\n  - فتح كارت\nالصنف\n  - نسخ رقم الصنف"),
    "الأب:\n  - فتح كارت الصنف\n  - نسخ رقم الصنف"
  );
});

test("falls back to separated prose blocks", () => {
  const items = core.parseText("## Improve login\n\nAdd unit tests for authentication.");
  assert.equal(items.length, 2);
  assert.equal(items[0].originalText, "Improve login");
});

test("formats accepted, rejected, and undecided decisions", () => {
  const prompt = core.formatPrompt([
    { originalText: "Original wording", editedText: "A revised\n  - First detail\n  - Second detail", status: "accepted", note: "Keep scope narrow", order: 0 },
    { originalText: "B", editedText: "B", status: "rejected", note: "", order: 1 },
    { originalText: "C", editedText: "C", status: "undecided", note: "", order: 2 }
  ]);
  assert.match(prompt, /هذه القائمة هي المرجع النهائي/);
  assert.match(prompt, /## المطلوب تنفيذه/);
  assert.match(prompt, /1\. A revised\n\s+- First detail\n\s+- Second detail/);
  assert.match(prompt, /توجيه ملزم: Keep scope narrow/);
  assert.doesNotMatch(prompt, /Original wording/);
  assert.match(prompt, /## مستبعد — لا تنفّذ/);
  assert.match(prompt, /## مؤجّل — لا تنفّذ/);
  assert.match(prompt, /نفّذ عناصر «المطلوب تنفيذه» فقط/);
  assert.match(prompt, /اسأل فقط إذا تعذّر التنفيذ/);
});
