# 117 — MusicBrainz review, queue and detail

Sections 6e and 6f, both marked *Selected*. Full width, not paired — "the layout
needs the room".

**6e.** Header is the paned form from [112](112-dialog-chrome.md): title, then a
muted caption "243 releases to review". Body is `212px 1fr`.

- **Queue** column, `1px` right border. A `QUEUE` eyebrow row at `7px 12px`
  over a 1px border, then the list scrolling **inside its own column** —
  `position: absolute; top: 25px; bottom: 0`. A row is 30px, `0 12px`, `gap 8`,
  a 32px weight-600 score then the album truncating. The selected row inverts:
  ink fill, ground text. Others carry a 1px top border and the hover veil.
- **Pane** follows the selection. Release line `800 13.5px/1.2` with a muted
  `400 12px` continuation on the same baseline ("— Cult of Luna · 9 of 11 files
  mapped"). Then the two covers, 82px each, current bordered and candidate not,
  each captioned `600 11px` over a muted `400 10.5px` line.
- **WRITE** box: `1px` border, `10px 12px`, eyebrow, then the field checkboxes
  wrapping at `8px 18px`, 14px marks.
- **Mapping table**: `1fr 62px 1fr`, `12px` gap, `7px 18px`. A `FILE` /
  `MUSICBRAINZ` eyebrow row between 1px borders, then rows of title over a
  muted tabular duration, with two 20px nudge buttons centred between the
  columns. A muted `400 11.5px/1.45` note closes it.
- **Footer**: "Back to queue" ghost on the left, then Cancel, Set aside, Apply.

Only the pane and the queue scroll; the header and the footer stay put. That is
the same one-size-one-scroller rule `App.css.test.ts` asserts for a paned
dialog.

**6f, progressive loading.** The file column is local and paints immediately;
only the MusicBrainz column is pending, so the pane never blanks out what Apex
already knows. A pending cell is a 10px bar at 66% width on the skeleton colour,
pulsing `1.1s ease-in-out infinite` between `1` and `.45` opacity. **No
spinner** — a 56px track 4px high filled to 25%, and a line of status: "Your
files are already here · matching candidates".

That pulse is a third exception to the global `animation: none`, so it joins
`ANIMATION_ALLOWED` in `App.css.test.ts` and needs the reduced-motion fallback
the guard requires of everything on that list.

`ReleaseLookup` is the caller. The six heights it passed through are recorded in
`App.css`; this layout is what settles them.

Part of the [component library sweep](../../plans/apex-components.md).
