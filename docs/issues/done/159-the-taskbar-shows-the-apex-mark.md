# 159 — The taskbar shows the Apex mark

`src-tauri/icons/` is still Tauri's scaffold icon set, so the taskbar, the
window and the installer show the Tauri logo. Replace the set with the Apex
mark — the square and play triangle `.appbar-mark` draws, in the dark theme's
`--accent` and `--on-accent` — from `src-tauri/icons/mark.svg` via
`tauri icon`. Only the files `tauri.conf.json` and the existing set use are
kept; the Android and iOS output is not.

## Verification

- Taskbar, Alt+Tab, the window's system icon and the installer show the mark.
- Sharp at 100% and 200% display scaling.
