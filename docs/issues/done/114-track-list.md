# 114 — Track list row

The row 7a Ember draws, applied to `SongTable` everywhere. Section 03 holds
only 3f, which is [120](120-grouped-releases.md); the row below is the type
specimen's, which is the only place the sheet draws a playing row at all.

- 32px, `400 12.5px/1`, `white-space: nowrap`. Text columns truncate with an
  ellipsis, numeric columns stay tabular and right aligned.
- A 1px separator under each row, inside the 32 so the pitch stays one number.
  The zebra goes — the sheet draws a rule, not banding. `--row-odd` stays for
  the browse list.
- The title column is ink and every other column is muted. The playing row
  brings them all up to ink and sets its title to 600.
- The playing row gains a 3px accent edge down its leading side. Not the
  selection fill the sheet draws with it: 7a draws one row that is playing and
  highlighted at once, and here those are two states that co-occur — a filled
  playing row would be unreadable against a selected one.
- A selected row takes its columns to ink as well. `--muted` over
  `--accent-tint` is 4.16:1 on dark, under AA.

The edge is a positioned `::before` rather than `box-shadow: inset 3px 0 0`:
`.drop-before` and `.drop-after` already own the row's `box-shadow` and a
shadow list cannot be composed from two rules.

The leading column stays 26px with the animated speaker and the missing-file
`!`. The sheet's 10px triangle is a static mark in a 14px column, which has
room for neither — and the speaker's motion is
[deliberate](../../knowledge/design.md), not decoration.

Rows still do not light up under the pointer. The sheet draws a hover veil on
both 7a and 3f; `App.css.test.ts` fails the build for one, on purpose, and that
stands.

Part of the [component library sweep](../../plans/apex-components.md).
