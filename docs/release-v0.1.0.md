# Codex Action Board v0.1.0

First public release of Codex Action Board.

Recommended GitHub release settings:

- Tag: `v0.1.0`
- Title: `Codex Action Board v0.1.0`
- Mark as pre-release: no
- Attach `dist/codex-action-board-v0.1.0.zip`
- Attach the generated `dist/codex-action-board-v0.1.0.zip.sha256`
- Attach `dist/demo.gif` and `dist/arabic-rtl.gif` as release assets.

## Highlights

- Review assistant suggestions as explicit actions before asking Codex to implement them.
- Accept, reject, postpone, edit, annotate, and reorder extracted actions.
- Open the board from an assistant response, selected text, the side panel, or `Ctrl+Alt+L`.
- Starts in English by default so Codex stays in its native LTR layout for English users.
- Use `Run-CodexActionBoard-Arabic.cmd` for Arabic/RTL, or switch language inside the board.
- Switch back to English mode to remove RTL mutations and return Codex to its native layout.
- Preview the final decision prompt before inserting it into the composer.
- Nothing is sent automatically.

## Security Notes

- Desktop mode starts Codex with a localhost-only Chromium DevTools port on `127.0.0.1`.
- Do not expose the DevTools port through tunnels, proxies, firewall rules, or shared machines.
- Save unfinished input before using the one-click launcher; it closes running Codex processes to reopen Codex with the debugging port enabled.
- Review scripts from forks before running them.

## Requirements

- Windows
- Node.js 20+
- Codex Desktop

## Verification

Verified locally before publishing:

```powershell
npm run build:extension
npm run check
npm audit --audit-level=moderate
npm run package:release
```

Optional live smoke test when Codex Desktop is open through the launcher:

```powershell
npm run inject -- --language=en
npm run verify:live -- --smoke
npm run inject -- --language=ar
npm run verify:live -- --smoke
```
