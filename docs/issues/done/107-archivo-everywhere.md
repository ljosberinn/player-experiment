# 107 — Archivo everywhere

Study **7a Ember**: one face doing everything. Segoe UI and Space Grotesk both
gone, `--font-numeric` with them.

`@fontsource/archivo`, latin subset, weights 400, 600 and 800, imported in
`main.tsx` and `.storybook/preview.ts` — vendored rather than fetched, because
the CSP forbids a font CDN and the app is offline first. The build ships three
woff2 and three woff.

## Three weights, so the sheet's 700s became 800

Archivo ships nine weights and the sheet names three. The app set `700` in eight
rules, which with only 400/600/800 loaded would have matched 800 anyway — and
the sheet's own bold roles are 800, so the rules say 800 rather than leaving
eight declarations that read as one weight and draw as another.

## Figures are the prose face now

The split used to do the aligning: Space Grotesk's figures against Segoe UI's
prose. One face means `font-variant-numeric: tabular-nums` is the only thing
keeping a column of numbers from shifting as it counts, so every element that
draws one asks for it — `.titlebar-version`, `.scrubber-time`, `.sidebar-count`,
`.song-cell.right`, `.statusbar-zoom-value`, `.stat-tile-value`. The last two
inherited the variant from the numeral token and had to be given it directly.

## Two stacks are not the split coming back

`.crash-notice-details` — the backtrace — took `--font-numeric`, whose fallback
chain was monospace. It is code, not figures, so it now names the same
`ui-monospace` stack the panic message above it already did, rather than
following the prose into a proportional face. The caption buttons keep Segoe
MDL2, which draws glyphs rather than letters.

`.drag-badge` restated the UI font to escape a numeral-faced ancestor. With one
face there is nothing to escape, so the declaration is gone.

## The guard, inverted

`App.css.test.ts` asserted the split. It now reads every `font-family` in the
sheet, skips those two stacks, and requires the rest to start `Archivo,`; it
asserts `--font-numeric` is nowhere in the file, and that each element above
sets the numeric variant.

`e2e/specs/appearance.test.ts` could no longer ask the computed family, which
says Archivo whether or not the woff2 arrived. It reads the registered faces out
of `document.fonts` — the three weights, by name — and checks that 400 actually
loaded. Registered rather than loaded for the other two, because a weight the
visible screen never draws stays unloaded and would fail a `check()`.

The sheet's sizes are **not** applied here. They are recorded in
[design.md](../../knowledge/design.md) and land role by role with the primitives
that use them, 110 onward.

Part of the [component library sweep](../../plans/apex-components.md).
