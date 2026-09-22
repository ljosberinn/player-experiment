# 127 — A select inside a dialog opens over it

Every drawn `Select` in a dialog opens *under* the dialog. Both are portalled
to `body`, and `.select-positioner` is `z-index: 10`
([library.css:555](../../../src/styles/library.css#L555)) against `.dialog`'s
`11` ([library.css:1320](../../../src/styles/library.css#L1320)). The list is
open, so the trigger keeps `[data-popup-open]`'s accent edge and the arrow keys
move a highlight in a listbox nobody can see. It has been this way since
`.select-positioner` landed in #239. `.suggest-positioner` already states `60`
for exactly this reason ([app.css:2490](../../../src/styles/app.css#L2490)).

Affected: Theme and Check For Changes in Settings, every select in
`SmartPlaylistEditor` (match rules, field, condition, sort by, sort direction), and the
one in `AlbumLinkDialog`. `StatsFilterBar`'s
selects are not in a dialog, and they work.

Raise `.select-positioner` to `60`, beside the suggestions. It stays under
`.drag-badge` (70).

**Why e2e passes.** `chooseTheme`
([appearance.test.ts:105](../../../e2e/specs/appearance.test.ts#L105)) clicks
the option through `tauri-plugin-wdio-webdriver`, whose element click is
`el.click()` on the node (`executor.rs` `click_element`). It never hit-tests,
so it clicks an option that is covered.

## Guards

- `App.css.test.ts` "positions every portalled overlay itself"
  ([App.css.test.ts:1215](../../../src/App.css.test.ts#L1215)): add
  `.select-positioner` and `.suggest-positioner`, and assert that each one
  that can open inside a dialog layers above `.dialog`.
- `chooseTheme`: before clicking, assert that `document.elementFromPoint` at
  the option's centre lands inside `[role='listbox']`.

## Verification

- In Settings ▸ Appearance, Theme opens a visible list over the dialog.
  Clicking an item and pressing Arrow and Enter both work.
- Check For Changes (Settings ▸ Library), the smart-playlist editor's selects
  and the album-link dialog's select all open visibly.
- A select near the dialog's bottom edge flips or nudges and stays inside the
  window.
