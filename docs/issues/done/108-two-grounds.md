# 108 — Two grounds, one token set

Light ships. `data-theme` on `<html>`, defaulting to the OS, overridable in
Settings → Appearance and persisted like the other preferences; `color-scheme`
follows it. No `@media (prefers-color-scheme:)` block — it would need a third
copy of every dark value, and three copies is how two of them drift.

The sheet is `src/styles/tokens.css`, `primitives.css` and `app.css`, imported
from `App.css` in cascade order. The guard reads the set, not the entry point.

## The palette

Both columns are the component sheet's study 7a, stated in `oklch` with the
design's hex beside each; every one round-trips to within 0.001 of oklab
distance. **Dark was re-based onto the sheet too**, so the two grounds come from
one source rather than two — its surfaces were ~3 JND darker before.

The stack inverts rather than repeating: coming forward is lighter on dark and
darker on light, and the sidebar recedes on both.

Three departures, each recorded beside the value:

- **`--muted` on light** — the sheet's `#6e6a67` is 4.22:1 on its own field and
  fails AA. Darkened by 0.016 of lightness, under a JND.
- **`--dim` folded into `--muted`.** The re-based grounds put the sheet's muted
  near the AA floor, so a third recessive step that is still AA cannot exist: on
  light the best available is L 0.515 against muted's 0.511.
- **`--field-border` stays ours**, above the sheet's `line` — that is a 1.5:1
  hairline, and a field border at 1.02:1 shipped once.

One pair cannot reach AA and says so in its own assertion: `--muted` on
`--skeleton` is 4.22:1 on light, and lifting the skeleton to fix it puts it
within 1.02:1 of the field it sits inside. The only text there is the search
field's clear glyph, so it is held to 1.4.11's 3:1.

## What the sheet had no opinion on

The translucent chrome and the blob layer are dark-ground inventions. Both stay,
with their own light values: veils at 0.80–0.86 against dark's 0.55–0.70, and
`--blob-opacity` halved. A translucent panel over a blob moves *toward* dark ink
and *away* from light ink, so the same blob costs a light ground far more
contrast. Worst composited case is 4.68:1.

## Guards

`App.css.test.ts` iterates both grounds: every contrast pair twice, plus the two
blocks declaring identical name sets — a token defined on one ground only is
silent, and invisible to anyone reviewing in the theme they use. It strips
comments before matching a block, because the file's own header names both
selectors and would otherwise match the shared `:root` for either ground.

`e2e/specs/appearance.test.ts` loops the colour block over both grounds against
the composited stack, and one spec drives Settings → Theme so a store that never
wrote the attribute cannot pass.

Storybook gets the ground from a toolbar global that writes the same attribute.

Part of the [component library sweep](../../plans/apex-components.md).
