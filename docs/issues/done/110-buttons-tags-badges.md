# 110 — Buttons, tags, badges

Section 01. `Button`, `IconButton` and `Tag` in `src/components/primitives/`,
drawn by a fourth sheet, `src/styles/library.css`. Nothing calls them yet;
callers migrate in their own issues.

## The fourth sheet

`library.css` imports between `primitives.css` and `app.css`. The reset is bare
element selectors and has to precede a class; a region has to be able to
overrule a primitive it wraps, and `.modal button` knows something `.button`
cannot — so the library sits between them rather than after.

One file for all the primitives, not one per component. The classes are global,
so a file boundary buys no scoping, and every sheet is an entry in
`App.css.test.ts`'s `SHEETS`: one forgotten there drops that primitive out of
every guard that asserts an absence. It splits by size, the way `app.css` did.

## Tag and Badge are one component

The sheet names both and draws them identically — same box, same type, same
padding; only the fill differs, and the fill is what the thing means. So `Tag`
takes a tone and there is no `Badge`. Two names for one drawing is what folding
`--dim` into `--muted` settled.

`Count` is its own component rather than a fifth tone: it drops the uppercasing
and the letter-spacing that make a tag read as a word, and takes the tabular
figures that keep a column of them from shifting.

## What the light ground cost

The sheet's button states assume its own mid-tone amber, and `--accent` on
light is already darkened to carry white. Three consequences, all in
[design.md](../../knowledge/design.md#tokens):

- **Hover and press move down on light**, not up. The sheet's own hover puts
  `--on-accent` at 4.43:1. Light steps 0.055 of lightness the other way, which
  is the inversion the surfaces make and the one the secondary and ghost kinds
  make anyway — their veils are ink here and white there.
- **`--accent-deep`**, for the accent drawn as a label *on a wash of itself* —
  a ghost button, a selection-filled tag, a toggled icon button. A wash over a
  light ground moves the surface toward the ink on it, so the step that clears
  4.5:1 on the bare ground does not clear it on its own highlight. Dark needs
  no such step and declares `--accent`'s value under the name.
- **The strongest ghost wash is 18%**, not the sheet's 22%, for the same
  reason. At 22% the label is 4.37:1 on the sidebar.

`App.css.test.ts` asserts all nine wash-over-surface pairs per ground, and the
primary button's three fills under `--on-accent`.

## Two rules the app kept

`cursor: pointer`, which the sheet writes on every button, stays out — it is
the one thing that would give the window away as a web page, and the sheet is
drawn in a browser. A disabled button does take `cursor: not-allowed`, which
the sheet's own row states.

Hover *is* allowed here, and `.button` and `.icon-button` join
`.window-buttons` in `HOVER_ALLOWED`. The guard is about rows, cells and list
items lighting up under a pointer that is only passing over them. A button is a
target, and every native one on this platform reports that it can be pressed.

## Smaller things

- **The primary button takes its focus ring back** in `--on-accent`.
  `:focus-visible` is `--accent` at `outline-offset: -2px`, which on an accent
  fill is the accent drawn on itself. Asserted, because it is invisible rather
  than merely subtle.
- **The 20px nudge button is 24px of hit area**, through an `::after` that
  reaches past the mark rather than padding that would grow it.
- `move-up` and `move-down` joined the icon registry — bold carets, because
  they are drawn at 9px inside that 20px box.
- `IconButton` puts `aria-pressed` on the element only when `pressed` is
  passed. `aria-pressed="false"` is a claim that a control is a toggle, and
  most of these are not.

Hover and press are live in the stories rather than drawn beside the rest
state: the only drift-free way to show a `:hover` would be a story-only class
in `library.css`, and story scaffolding has no business in the sheet.

Part of the [component library sweep](../../plans/apex-components.md).
