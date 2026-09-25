# 158 — The app draws its own frame again

Reverts 119 (#251). `decorations: false` returns; `AppBar` becomes the title
bar again and owns the window's behaviour.

- Drag region, double-click to maximise, minimise/maximise/close buttons.
- Capability regains `allow-minimize`, `allow-toggle-maximize`, `allow-close`,
  `allow-start-dragging`.
- The e2e build keeps `decorations: true`; the frameless window goes back under
  **Uncovered on purpose** in `testing.md` and `limitations.md`.
- Window title turns invisible again; the comments and `frontend.md` say so.

## Verification

- Drag, double-click, snap layouts (hover maximise) and the three buttons behave
  as a native frame's.
- No OS title bar above the app's.
