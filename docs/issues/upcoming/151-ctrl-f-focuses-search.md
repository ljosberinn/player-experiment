# 151 — Ctrl+F focuses search

Ctrl+F focuses `SearchBox` and selects its text. `preventDefault`, so WebView2's
own find bar never opens.

Works from inside the search box too. Not while a dialog is open.

## Testing

- `e2e/specs/shortcuts.test.ts`: dispatched chord, focus lands in the field with text selected.
- `docs/knowledge` shortcut list updated.
