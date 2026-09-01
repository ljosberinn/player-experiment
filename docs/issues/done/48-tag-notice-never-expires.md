# 48 — "Updated 1 song." stays on screen forever

`useEditorStore` gained `dismissNotice`, matching the playlists store's. The
three expiry effects in `App.tsx` (toolbar, playlists store, editor store)
collapsed into one hook, `useNoticeExpiry(value, clear, ms)` in
`src/features/shell/useNoticeExpiry.ts`, called three times.

The toolbar's `clear` is `useCallback(() => setToolbarNotice(null), [])` rather
than an inline arrow — the hook puts `clear` in its effect deps, and an
identity that changes every render would restart the timer every render.
