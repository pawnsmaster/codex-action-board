# Codex Action Board

The missing review layer for vibe coders using Codex.

Codex is great at producing plans, refactors, and long lists of suggested changes. The hard part starts when you agree with most of the answer, disagree with a few items in the middle, want to postpone others, and need to add notes before anything becomes code.

Codex Action Board turns an assistant response into a local checklist inside Codex. You review each suggested action, decide what should happen, then insert one focused instruction back into the composer. Nothing is sent automatically.

![Codex Action Board demo](https://github.com/pawnsmaster/codex-action-board/releases/latest/download/demo.gif)

## Why this exists

Without a review layer, follow-up prompts get messy fast:

- "Do everything except item 4."
- "Also change item 7, but keep the current UI."
- "Ignore the security refactor for now."
- "Actually only implement the bullets under the Arabic section."

That works for small replies. It breaks down when Codex gives you 10, 20, or 30 suggestions and you only want some of them.

Action Board gives you a deliberate step between "Codex suggested this" and "Codex should implement this."

## What it does

- Extracts actionable suggestions from an assistant response.
- Lets you accept, reject, postpone, edit, annotate, and reorder actions.
- Opens from a full assistant response or only from selected text.
- Inserts a structured decision prompt into the Codex composer.
- Keeps you in control: it never sends the prompt automatically.
- Starts in English by default, with Arabic RTL mode available in the same build.

## Language behavior

Action Board ships as one build with two launch paths:

- `Run-CodexActionBoard.cmd` starts Action Board in English and leaves Codex in its native LTR layout.
- `Run-CodexActionBoard-Arabic.cmd` starts Action Board in Arabic and enables the RTL engine.

The last language you choose is saved locally. Launching either CMD again intentionally rewrites that preference, so the English launcher restores English/LTR and the Arabic launcher restores Arabic/RTL from the beginning of the renderer session.

You can also switch language from inside Action Board at any time.

## Arabic and RTL support

Action Board was built for mixed Arabic/English Codex conversations.

![Arabic and RTL support](https://github.com/pawnsmaster/codex-action-board/releases/latest/download/arabic-rtl.gif)

In Arabic mode:

- Arabic paragraphs, lists, Markdown, labels, inputs, and board controls display right-to-left.
- Mixed Arabic and English text keeps a stable reading order.
- English words, numbers, shortcuts, file names, and punctuation stay readable inside Arabic text.
- Code blocks, inline code, terminals, paths, and programming syntax stay left-to-right.
- The board itself uses RTL layout, not only RTL text alignment.

In English mode:

- The Action Board UI switches to English/LTR.
- Codex returns to its native layout.
- RTL mutations are removed instead of only hidden.

## How you use it

1. Let Codex produce a plan or a long answer.
2. Open Action Board from the checklist button beside the response.
3. Review each extracted action:
   - accept the items you want implemented;
   - reject the items you do not want;
   - postpone the items you want later;
   - edit the action text or add notes where needed.
4. Preview the final instruction.
5. Insert it into the Codex composer.
6. Review it one last time, then send it yourself.

You can also select part of a response and open Action Board only for that selection. This is useful when a response is huge but you only care about one section.

## Entry points

Action Board can be opened from:

- the checklist button beside an assistant response;
- the floating button that appears near selected assistant text;
- the Codex side panel entry;
- the keyboard shortcut `Ctrl+Alt+L`.

The response button is intentionally conservative: Action Board only adds it when it can identify the message as an assistant response. This avoids placing action controls on user messages or unrelated UI. If the button does not appear on a response because Codex changed its markup, select the relevant text manually; the floating Action Board button will appear for the selection.

## Quick Start

**Download, extract, and double-click `Run-CodexActionBoard.cmd`.**

1. Download [`codex-action-board-v0.1.0.zip`](https://github.com/pawnsmaster/codex-action-board/releases/latest/download/codex-action-board-v0.1.0.zip).
2. Extract the ZIP.
3. Save any unfinished input in Codex.
4. Double-click `Run-CodexActionBoard.cmd` for English, or `Run-CodexActionBoard-Arabic.cmd` for Arabic/RTL.

Requirements: Windows, Node.js 20+, and Codex Desktop.

Codex may remain active after its window is closed. The launcher safely closes any running Codex processes, starts a fresh session with a localhost-only DevTools port, and injects Action Board automatically.

## Manual Start

For users who prefer not to run the CMD launcher, install dependencies from PowerShell:

```powershell
npm ci --ignore-scripts
```

Close Codex Desktop completely, then start it with the local debugging port:

```powershell
.\desktop\Launch-CodexActionBoard.ps1
```

In another terminal, inject Action Board:

```powershell
npm run inject
```

To force the manual injection language, use:

```powershell
$env:CODEX_ACTION_BOARD_LANGUAGE = "en"
npm run inject
```

or:

```powershell
$env:CODEX_ACTION_BOARD_LANGUAGE = "ar"
npm run inject
```

If the injector cannot find Codex, keep a conversation open and run `npm run inject` again.

## What the launcher does

- Closes running or background Codex processes so the DevTools port can be enabled.
- Checks that Node.js and npm are installed.
- Runs `npm ci --ignore-scripts` on the first launch.
- Starts Codex with a DevTools port bound only to `127.0.0.1`.
- Writes the requested local language preference (`en` or `ar`).
- Injects Action Board and enables RTL only when Arabic mode is selected.

It does not change your messages, account data, or Codex installation files.

## Browser Extension

The browser extension applies the same Action Board and RTL behavior to `chatgpt.com`.

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the `extension` folder.

Codex Desktop is Action Board's primary target. The browser extension is useful when you want the same review flow in ChatGPT.

## Security

Desktop mode uses Chromium DevTools because Codex Desktop does not currently expose a documented plugin API for this kind of local UI extension.

The launcher binds DevTools to localhost only:

```text
127.0.0.1:9223
```

Do not expose this port through a tunnel, proxy, firewall rule, or shared machine. The injector refuses non-local DevTools targets.

Read [`SECURITY.md`](SECURITY.md) and [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) for the threat model and audit notes.

## Limitations

- Desktop injection lasts for the current renderer session. If Codex reloads or restarts, either run the one-click launcher again (`Run-CodexActionBoard.cmd`) or use the manual flow and run `npm run inject` after Codex is open.
- The desktop launcher depends on Codex accepting Chromium flags. If a future Codex build blocks that, use the browser extension path until a better app-level hook exists.
- CSS selectors are intentionally broad because Codex UI class names can change.

## Development

After editing files in `src/`, sync the browser extension copy:

```powershell
npm run build:extension
```

Before opening a PR or release:

```powershell
npm run check
npm audit --audit-level=moderate
npm run package:release
```

## Project Layout

- `src/`: shared Action Board code and optional RTL engine/CSS.
- `desktop/`: Codex Desktop launcher, injector, and live verifier.
- `extension/`: unpacked Chrome/Edge extension.
- `scripts/`: sync, validation, and release packaging helpers.
- `docs/architecture.md`: implementation details.
- `docs/security-checklist.md`: release safety checklist.
- `SECURITY.md`: threat model and safe usage.
- `SECURITY_AUDIT.md`: security audit report.

## License

MIT
