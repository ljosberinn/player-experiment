# 49 — "Get Info" is called Edit everywhere except its own title bar

The row menu says "Edit" / "Edit 12 Songs" (`library/rowMenu.ts`). The dialog it
opens is still titled `Get Info` / `Get Info — 12 songs`
(`editor/TagEditor.tsx`). One name, and it is the menu's.

Also stale: the comments in `rowMenu.ts`, `useSelectionShortcuts.ts` and
`e2e/specs/appearance.test.ts`, the dialog's accessible name in
`TagEditor.test.tsx` and `App.test.tsx`, and the sample labels in
`ContextMenu.test.tsx`.

The Edit menu then reads Edit ▸ Edit for a selection of one. That is what the
menu bar of every editor does with its own verb; check it in the app before
inventing a distinct label for it.
