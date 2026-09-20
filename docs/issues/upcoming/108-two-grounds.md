# 108 — Two grounds, one token set

Light ships. The design draws every specimen on both grounds from one set of
names, so the theme becomes a variable swap and nothing else — which is the
thing the indirection in `App.css` was kept for.

The sheet's own names and values, 7a:

| Token | Light | Dark |
| --- | --- | --- |
| ground | `#f3f2f2` | `#17140f` |
| surface | `#e6e4e2` | `#221d17` |
| ink | `#201e1d` | `#f0ece7` |
| muted | `#6e6a67` | `#948b81` |
| line | `#cbc7c4` | `#3a332b` |
| accent | `#e8730f` | `#f58a1f` |
| accent deep | `#b4550a` | `#d97410` |
| selection | `#f7e3cf` | `#3a2a15` |
| dialog | `#f8f7f7` | `#1d1915` |
| behind dialog | `#e9e7e6` | `#100e0b` |
| separator | `#dbd7d4` | `#2a231c` |
| section rule | `2px rgba(32,30,29,.4)` | `2px #3a332b` |
| hover veil | `rgba(32,30,29,.055)`–`.07` | `rgba(255,255,255,.06)`–`.08` |
| disabled fill / border / text | `#eeecec` / `#dbd7d4` / `#a4a09d` | `#1f1b16` / `#2a231c` / `#6b6259` |
| dialog shadow | `0 12px 32px rgba(32,30,29,.22)` | `0 12px 32px rgba(0,0,0,.6)` |
| menu shadow | `0 3px 10px rgba(32,30,29,.16)` | `0 3px 14px rgba(0,0,0,.5)` |

**Stated in `oklch`, with the design's hex in a comment beside each.**
`App.css.test.ts` converts oklch channels to WCAG luminance to compute every
ratio it asserts; hex would cost that. Anything that does not round-trip to the
design's hex within a JND is the design's value, not ours — say so in the
comment.

Three things follow:

- The guard slices the first `:root {` block and reads tokens out of it by
  name. It has to iterate both blocks and assert every contrast pair twice.
- `e2e/contrast.ts` flattens the live stack, so the appearance suite runs per
  theme. Either a second pass or a parameter on the existing one.
- The translucent chrome (`--chrome-veil`, `--sidebar-veil`, `--strip-veil`) and
  the dynamic background are dark-ground inventions. Light needs its own
  opacities or it needs them off; the sheet has no opinion, so this is ours to
  decide and write down in `design.md`.

Where the theme lives: a `data-theme` attribute on `html`, defaulting to the OS
via `prefers-color-scheme`, overridable in Settings → Appearance beside Interface
Zoom, persisted like the other preferences. `color-scheme` follows it.

Storybook gets the same attribute from a toolbar global, so the specimen sheet
of [106](../done/106-storybook.md) draws on either ground.

Good moment to split the sheet. `App.css` is 3345 lines and two token blocks
make it longer; `src/styles/tokens.css`, `primitives.css` and the rest, imported
from `App.css`, keeps the guard working if it reads the set rather than the one
file.

Part of the [component library sweep](../../plans/apex-components.md).
