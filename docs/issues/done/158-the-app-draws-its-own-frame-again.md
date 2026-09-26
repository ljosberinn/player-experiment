# 158 — The app draws its own frame again

Reverts 119 (#251). `decorations: false` returns; `AppBar` becomes the title
bar again and owns the window's behaviour. It keeps its name.

- Drag region, double-click to maximise, minimise/maximise/close buttons after
  the search field, 48×40 (the sheet's 44×36 through 129's map).
- Capability regains `allow-minimize`, `allow-toggle-maximize`, `allow-close`,
  `allow-start-dragging`.
- The e2e build keeps `decorations: true`; the frameless window goes back under
  **Uncovered on purpose** in `testing.md` and `limitations.md`.
- Window title turns invisible again; the comments and `frontend.md` say so.
- No snap layouts on hovering maximise (see `limitations.md`); a plugin with a
  native hit-test overlay was declined.

## Verification

- Drag, double-click and the three buttons behave as a native frame's; Win+Z
  and dragging to a screen edge snap.
- No OS title bar above the app's.
