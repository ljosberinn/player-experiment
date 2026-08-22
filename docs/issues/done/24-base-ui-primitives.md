# 24 — Base UI primitives

Merged in #36. `@base-ui/react` (**not** `@base-ui-components/react`, the former
name, still published at `1.0.0-rc.0`). It ships no CSS, so this was a behaviour
swap: `App.css` keeps its tokens and each part is handed the class that already
exists.

Why, when phase 13 argued for hand-rolling: those arguments were against an *OS*
menu and an *OS* message box, not against a headless primitive. What did not hold
was the cost — submenu alignment, collision nudging, outside-click capture and
focus restoration had all been debugged by hand, and neither modal had a focus
trap or an inert background.

- `ContextMenu` is `ContextMenu.Root/Trigger` with the region as the trigger.
  **A spike established this had to be a call-site refactor, not an adapter
  swap**: Base UI wires arrow-key handling through the trigger, and a menu
  rendered `open` at a captured position has none. Six of thirteen keyboard tests
  failed against an otherwise-working adapter.
- `ConfirmDialog` is `AlertDialog`, both editors are `Dialog`, `useDialogKeys` is
  deleted — Escape is the library's and Enter-to-accept is a real
  `<form onSubmit>`. `TabBar` is `Tabs`, both sliders are `Slider`, the library
  actions a `Toolbar`.
- Deleted with them: the measure-then-nudge effect, the resize and scroll close
  handlers, the capture-phase `mousedown` listener, the `step`/`choose` keyboard
  machine, the `createPortal` out of `<thead>`.
- **The scrubber's real win was `onValueCommitted`** — a range input's `onChange`
  fires throughout a drag, so dragging across a five-minute song sent a real seek
  per pixel. Volume keeps `onValueChange`, because it is meant to be heard as it
  moves.
- `ConfirmDialog` re-claims focus on the next frame: every route into it is a
  context menu, and a menu returns focus to its trigger *after* the dialog took
  it.

Three noticeable behaviour changes, none a regression: arrow keys land on
disabled menu items (the ARIA recommendation), right-clicking a playlist no
longer selects it (a per-row trigger answers the question), and tabs activate on
Enter rather than on arrow (selecting a tab re-runs the query).

**The editors stopped here, by this phase's own stop clause.** The three
`<select>`s stay native — a native select in a webview opens a real OS popup,
which is closer to native than any listbox — and `Field` was skipped with them.

**Bundle: 464.85 kB raw / 149.98 kB gzipped**, against 291.63 / 90.54 after phase
20: **+173 kB raw**, larger than "tree-shaken per component" implies. For an app
loading from local disk it buys a focus trap, an inert background, real collision
handling and a tablist that works — but the number is the number.

`vite.config.ts` gained its first accepted rollup warning here, scoped to cycles
whose every module is inside `node_modules`.
