# 110 — Buttons, tags, badges

Section 01. The first three primitives in `src/components/primitives/`.

`Button`, four kinds, label centred, `800 13px/1.2`:

| Kind | Rest | Hover | Active |
| --- | --- | --- | --- |
| primary | accent fill, `--on-accent` label, no border, `8px 14px` | `#f58a1f` / `#ffa040` | `#d0650c` / `--accent-deep` |
| secondary | transparent, `1px solid` line, `8px 14px` | hover veil, border to `#9b9694` / `#5b5147` | doubled veil |
| ghost | accent-deep text, transparent border, `8px 6px` | accent at 12% / 14% | accent at 22% / 24% |
| disabled | secondary at `opacity: .45`, `cursor: not-allowed` | — | — |

**At most one primary per surface.**

`IconButton`: 32px square in toolbars, 36px in dialogs, 20px for the two nudge
buttons inside a mapping row. `1px solid` line, 14px glyph. Toggled is selection
fill, accent border, accent-deep glyph.

`Tag` and `Badge`, `800 10.5px/1`, `.06em`, uppercase, `4px 7px`:

- solid accent (Lossless)
- selection fill with accent-deep text (Smart)
- neutral veil at 9% (Missing)
- outlined, line border, ink text (a genre)
- count: `800 10.5px`, `3px 6px`, accent fill, `min-width: 20px`, centred — not
  uppercase, no letter-spacing

Hit area is 24px minimum even where the drawn mark is smaller.

Stories cover every row of both tables on both grounds. Callers migrate in their
own issues; this one only adds the primitives and draws them.

Part of the [component library sweep](../../plans/apex-components.md).
