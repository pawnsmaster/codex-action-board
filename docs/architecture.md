# Architecture

Codex Action Board has one shared review layer, an optional RTL engine, and two delivery paths.

## Shared Assets

- `src/codex-rtl-engine.js`: exposes reversible RTL enable/disable lifecycle functions, classifies Arabic-heavy text blocks, and cleans every injected direction marker when disabled.
- `src/rtl-style.css`: CSS overrides for RTL text and LTR code blocks.
- `src/action-board-core.js`: deterministic Markdown parsing and decision-prompt formatting.
- `src/action-board.js`: response discovery, selection trigger, review panel, and composer bridge.
- `src/action-board.css`: host-inheriting responsive UI styles.

Run this after editing shared assets:

```powershell
npm run build:extension
```

That copies shared assets into `extension/`, because Chrome extensions cannot load files outside their own folder.

## Desktop Path

1. `Run-CodexActionBoard.cmd` is the user-facing double-click launcher.
2. `desktop/Run-CodexActionBoard.ps1` checks prerequisites, installs dependencies when needed, launches Codex, then injects Action Board.
3. `desktop/Launch-CodexActionBoard.ps1` launches Codex Desktop with a localhost-only DevTools port.
4. `desktop/inject-action-board.mjs` finds a Codex renderer target on `127.0.0.1`.
5. The injector evaluates the shared JavaScript and CSS in that renderer.

The injection is session-local. If Codex reloads, run `npm run inject` again.

## Browser Extension Path

The extension loads the same JavaScript and CSS on `chatgpt.com`.

## Direction Rules

- The saved Action Board language is the source of truth: Arabic enables RTL and English disables it.
- Disabling RTL disconnects its observer and removes generated `dir`, data attributes, and Latin-run isolation wrappers.
- Arabic-heavy message text becomes RTL.
- Mixed Arabic/English text uses `unicode-bidi: plaintext`.
- Code, terminals, file paths inside code blocks, and editors stay LTR.
- Composer/input areas are ignored to avoid typing lag.
