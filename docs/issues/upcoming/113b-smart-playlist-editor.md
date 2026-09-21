# 113b — The smart playlist editor's interior

Section 6a, inside the chrome [113](113-dialog-chrome.md) gave it. Stacked on
113, which lands the dialog's header, body and footer and the status line.

- **Name row.** Muted `400 12.5px` label in a 44px column, field with an accent
  border — `--accent`, not the focus ring, so it reads as the field the dialog
  opened on.
- **Rule box.** `1px solid var(--menu-border)`, `12px` padding, replacing the
  `--chrome-border` edge and `--surface` fill `.filter-group` wears. Header line
  is `Match [any ▾] of the following:`, then `+ Rule` and `+ Group` pushed
  right as small buttons, `800 12px`, `6px 11px`.
- **Rule rows are one grid**, `130px 130px 1fr 30px`, `6px` gap, so the selects
  line up down the column instead of each row packing its own flex.

## What the grid has to survive

The sheet draws two rows of `[select][select][text][✕]`. The editor has four
shapes and the grid has to take all of them without a row going out of
alignment:

- `ValueEditor` returns `null` for `kind: "none"` (`is loved`). The cell stays,
  empty.
- `inLast` appends a `days` span. Value and unit share the `1fr` cell.
- A nested `GroupEditor` is a **sibling** of the rule rows inside the same box,
  so it spans `1 / -1`. Its own rules are a grid of their own, which is what
  keeps a nested group's selects aligned with each other rather than with the
  outer group's.
- The root group's header line is not a rule row; it spans `1 / -1` too.

The remove button is a 30px square cell — `IconButton`, not the `✕` text button
the rows carry today.

## The disabled rows

**They already stay in place.** 111 rendered the sort and limit rows always,
with `disabled` selects, so the behaviour the sheet asks for is not the change.
What changes is what disabled looks like: `--field-disabled` fill,
`--chrome-border` edge and `--faint` text, replacing `.select[data-disabled]`'s
`opacity: 0.45`. That opacity stays the primitive's default; the dialog's own
rule is what overrides it, because a control disabled *in place to be read* is
not the same as one disabled because it cannot be used yet.

`100` sits in a 62px box — `.filter-order input[type="number"]` is 72px today,
and the comment about a five-digit cutoff goes with it.

`.filter-order input:disabled { color: var(--muted) }` is replaced by `--faint`.
The WCAG 1.4.3 note it carries still holds and moves to the new rule.

E2E: a screenshot of the editor with two rules and a nested group, on both
grounds. `smart-playlists.test.ts` selects `.dialog-field input` after 113's
rename; the grid does not change what it reaches.

Part of the [component library sweep](../../plans/apex-components.md).
