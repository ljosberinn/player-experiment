# 113 — Dialog chrome

Section 06's shell, pulled out of the eight dialogs that each draw their own.

`Dialog` in `src/components/primitives/`, drawn by `library.css`. `app.css`
loses its `.modal` block; the classes are renamed `.dialog*` so the component
and its drawing agree, and every selector in the unit and e2e suites moves with
them.

## The primitive

One component over both Base UI roots. `ConfirmDialog` and `CrashNotice` are
`AlertDialog` — a backdrop click cannot dismiss them, which is the whole reason
they are alerts — and the other five are `Dialog`. A `role` prop picks the root
so a caller never imports Base UI.

`.dialog` itself carries the fill, the border and the shadow and **no padding**;
each region pads itself, because a paned dialog's header and body do not agree
about what the edge is worth.

| | |
| --- | --- |
| Popup | `--chrome` over `--sidebar`, `1px solid var(--menu-border)`, `var(--shadow-dialog)` |
| Header | `800 17px/1.1`, `padding: 18px 18px 12px`, `border-bottom: 2px solid var(--rule)` |
| Body | `padding: 14px 18px` |
| Footer | `border-top: 2px solid var(--rule)`, `padding: 12px 18px 18px` |

`--menu-border` rather than the `--chrome-border` `.modal` wears today: the
sheet's dialog edge is `#cbc7c4` / `#3a332b`, which is the menu token on both
grounds, and `--chrome-border` is a step lighter than the drawing.

**Paned.** Header is `800 16px` at `16px 18px 12px` with an optional muted
`400 12.5px` caption on the same baseline, and the footer is `12px 18px`. The
body keeps the ordinary padding — 6e's edge-to-edge columns are that layout's,
not a property of panedness, and both dialogs that are paned today want the
edge. The caption and the footer's left-hand
slot get no caller until [118](118-musicbrainz-review.md) fills them in; they
land here because they are the same two rules, and the story is what draws
them until then.

**Footer.** Actions bottom right, **primary last**, `8px` apart, as `<Button>`.
A left-hand slot for the one action that leaves rather than completes ("Back to
queue", ghost), and a muted `400 11.5px` status line in the same slot when the
dialog has a count to state instead. `justify-content: space-between`, so a
footer with neither still puts its actions right.

## Three tokens, and a fourth kind

`tokens.css` gains three, both grounds:

- `--rule`, the 2px section rule: `oklch(0.237 0.004 49 / 0.4)` light,
  `oklch(1 0 0 / 0.135)` dark. Its own name although it equals `--menu-border`
  on dark — on light the sheet draws the rule at `.4` and the edge at `.2`, so
  one token cannot be both.
- `--shadow-dialog`: `0 12px 32px oklch(0.237 0.004 49 / 0.22)` light,
  `0 12px 32px oklch(0 0 0 / 0.6)` dark. `--shadow` is the menu's `0 3px 10px`
  and stays it.
- `--field-disabled`, a disabled control's fill: `oklch(0.945 0.002 17)` light,
  `oklch(0.225 0.011 73)` dark. Its border is `--chrome-border` and its text
  `--faint`, both of which already land on the sheet's hexes. Used by
  [113b](113b-smart-playlist-editor.md); declared here because tokens are one
  file and one guard.

`Button` gains a fourth kind, **`destructive`** — `--destructive` fill and
border, `--on-danger` text. The sheet never draws it, and `ConfirmDialog` needs
it: `.dialog-footer button` and `.modal-actions .destructive` both go away, so
there is nowhere else for it to live.

**The sheet contradicts itself on footer padding.** §01 draws primary and
secondary at `8px 14px` and the ghost at `8px 6px`; §06 draws `8px 18px`,
`8px 16px` and `8px 14px`. §01 wins — it is the primitive's own drawing and it
shipped in 110 — so a dialog footer states no padding of its own.

## The eight callers

All of them, because `app.css` loses the `.modal` block and there is nowhere
for a holdout to stand: `ConfirmDialog`, `CrashNotice`, `SettingsDialog`,
`AlbumLinkDialog`, `GenreOverrideDialog`, `SmartPlaylistEditor`, `TagEditor`
and `ReleaseLookup`. Every `<button>` in a footer becomes a `<Button>`.

Two of them keep an interior this issue does not touch. `ReleaseLookup` takes
the paned chrome and nothing else — its queue and pane are
[118](118-musicbrainz-review.md), which is written against this header
already. `SmartPlaylistEditor` takes the footer's status line — "2 conditions ·
116 songs match" is the `.modal-summary` paragraph it already renders above its
actions — and its rule grid is [113b](113b-smart-playlist-editor.md).

`.dialog.settings` and `.dialog.lookup` keep their own `height: min(...)` rules
in `app.css`: one size and one scroller is a property of those two dialogs, not
of the primitive.

## Guards

`App.css.test.ts`:

- The paned guard moves to `.dialog.paned > .dialog-body` and keeps asserting
  `overflow: hidden` above and one `overflow-y: auto` below.
- The `.modal button` exemption in the import-order test goes — nothing beats
  `.button` from a region any more, so the comment loses its example and needs
  a new one.
- A new one: no `.dialog*` rule in `app.css` states `border`, `padding` or
  `box-shadow` on the popup. The point of the primitive is that a dialog cannot
  quietly grow its own chrome.
- `--rule` gets no contrast assertion. It is a separator, not a control part,
  and at `.4` over `--chrome` it is 2.47:1 — which is the drawing.

`Dialog.stories.tsx`: default, paned with a caption, a footer with a status
line, a footer with a left slot, and the destructive confirmation.

E2E: the renamed selectors, and a screenshot of the confirmation and of Settings
on both grounds — this changes the edge, the rule and the shadow of every dialog
in the app.

Part of the [component library sweep](../../plans/apex-components.md).
