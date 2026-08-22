# 3 — Shell UI: chrome and the virtualized table

Merged in #3.

The custom title bar (`decorations: false`, own drag region and window buttons),
the virtualized song table over the paged query, placeholder rows with page
eviction, and the selection model.

- **This entry originally claimed resizable, reorderable, toggleable columns and
  was ticked as merged.** It delivered none of them, which is how the gap went
  unnoticed until a real build. Columns became phase 20, browse tabs phase 19.
- `selectAll` was written, tested, and left with **zero callers** — the player
  shortcuts ignore anything with a modifier, so Ctrl+A could never reach them.
  Fixed in phase 13's sweep with `useSelectionShortcuts`.
