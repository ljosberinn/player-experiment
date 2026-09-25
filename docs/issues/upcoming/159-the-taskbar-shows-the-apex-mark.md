# 159 — The taskbar shows the Apex mark

`src-tauri/icons/` is still Tauri's scaffold icon set, so the taskbar, the
window and the installer show the Tauri logo. Replace the set with the Apex
mark — the accent rounded square and play triangle `.appbar-mark` draws — from
one source SVG via `tauri icon`.

## Verification

- Taskbar, Alt+Tab, the window's system icon and the installer show the mark.
- Sharp at 100% and 200% display scaling.
