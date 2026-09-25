# 151 — Ctrl+F focuses search

Ctrl+F focuses `SearchBox` and selects its text. Always `preventDefault`, so
WebView2's own find bar never opens.

Works from inside the search box too. Moves no focus while a dialog is open.

## Testing

- `SearchBox.test.tsx`: focus and selection, Cmd+F, other chords ignored, dialog open.
- `e2e/specs/shortcuts.test.ts`: dispatched chord, focus lands in the field with text selected.
- `docs/knowledge` frontend and testing shortcut notes updated.
