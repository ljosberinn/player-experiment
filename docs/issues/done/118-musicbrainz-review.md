# 118 — MusicBrainz review, queue and detail

Sections 6e and 6f. The queue stops being a screen the dialog switches to and
becomes a column beside the pane, so 243 releases are one dialog rather than
243.

**Header.** The paned form from [113](113-dialog-chrome.md): `DialogHeader`'s
title, and its `caption` carries "243 releases to review" — which is where the
count moves out of `title()`. `.lookup-subject` goes with it; the pane names
the release now.

**Body.** `212px 1fr`, and the body stops scrolling: each column scrolls
inside its own track.

- **Queue**, `1px` right border. A `QUEUE` eyebrow at `7px 12px` over a 1px
  border, then the list. `grid-template-rows: auto 1fr` with `min-height: 0`
  rather than the sheet's `position: absolute; top: 25px` — the eyebrow's
  height is not a number worth writing down twice. A row is 30px, `0 12px`,
  `gap 8`, a 32px weight-600 score then the album truncating. The selected row
  inverts: ink fill, ground text. Others carry a 1px top border and the hover
  veil. A listbox, so ↑/↓ move the selection — [121](../upcoming/121-arrows-move-the-selection.md)
  is the track list and does not reach in here.
- **Pane**, in three regions: the subject line, the source, the mapping.

**The queue row keeps two of five columns, and one of the three that go has
nowhere else to be.** Artist and the mapped count move to the subject line
("— Cult of Luna · 9 of 11 files mapped"); the pressing moves to the candidate
list, which draws it already. But a track count that disagrees with the
candidate is *why* a release at 97% is in the queue at all, and with it gone
the sort is unexplained. It rides the score cell in `--danger`, which costs no
width.

**The sheet does not draw the candidate step, and it cannot be skipped.**
`pick` is a rate-limited fetch — one request out every ten seconds — so a pane
that fetched the top candidate on selection would spend a round trip per
arrow key. Selecting stays free: a review entry arrives with the pass's
candidates and `enter` makes no request. So the **source** region holds the
candidate list until one is picked, and what 6e draws — the two 82px covers,
current bordered and candidate not, each captioned `600 11px` over a muted
`400 10.5px` line, then the `WRITE` box at `1px`/`10px 12px` with its
checkboxes wrapping at `8px 18px` — is the after-pick state of that same
region. `back` clears the pick and the list returns in place.

**Mapping.** `1fr 62px 1fr`, `7px 18px`, under a `FILE` / `MUSICBRAINZ`
eyebrow row between 1px borders. It stays a `<table>`: `table-layout: fixed`
states those three widths, and file ↔ MusicBrainz is what a table is for. Rows
are a title over a muted tabular duration, with `IconButton`'s `nudge` place
between the columns — 110 drew the 20px box and the registry's `move-up` /
`move-down` carets for exactly this, and the `▲`/`▼` text buttons were what
stood in. `text-align: center` rather than the sheet's flex row: `display:
flex` on a `<td>` takes it out of the table box, and the row's line breaks
around the buttons where the anonymous cell replaces it. A muted
`400 11.5px/1.45` note closes it.

**The covers are 82px, and the border is the placeholder's.** The sheet draws
one bordered and one not, which reads as a rule about current against
candidate — but the bordered one is its empty box and the other is a filled
swatch. So the edge goes on `.tag-cover-art-empty`, which is what tells an
unknown cover from a blank one, and the tag editor's accent hairline comes
off both.

**Footer.** Three buttons on the right, as the sheet draws: Cancel, Set aside,
Apply. `.lookup-confirm-actions` folds into it, which is what its own comment
said 118 was for.

- **The lead is not "Back to queue".** With the queue on the left, back to it
  is clicking another row; the label presumes a screen this layout removed.
  The slot holds whichever step back is live — **Back to Results** while a
  candidate is picked, **Search again** while one is not. They are the same
  move at two depths, so one slot is enough, and Search again has to live
  somewhere now that `.lookup-refresh` sat under a list that moved into the
  pane. It retires a `.link-button`.
- **Skip goes.** It meant "back to the table" on the review queue and "next
  release" on a selection. Both are now clicking another row.

**6f is not 6e's pane.** It is a narrower specimen — `1fr 1fr` with no nudge
column, 16px padding, 12px/10.5px type, its own two-line header. Its metrics
would give the mapping two row treatments, so what it contributes is
behaviour: the file column is local and paints as soon as `tracks` land, and
only the MusicBrainz column is pending. That covers `searching` and
`fetching` alike — in both the app knows the files and not the release.

- **The pending cell is `.skeleton`, and it does not pulse.** The sheet's bar
  is 10px on the skeleton colour at 66%; `.skeleton` is 10px on the skeleton
  colour at 70%. What is new is the pulse, and three rules already in the app
  — `.chart-skeleton`, `.heatmap-skeleton .heatmap-cell`, `.bar-list-skeleton`
  — each say "no shimmer" in as many words. A fourth skeleton that animates
  either makes two kinds of skeleton or regrades the other three, and it buys
  nothing the sheet's own "no spinner" does not already have: the rail and the
  status line are the pending affordance. So `ANIMATION_ALLOWED` is untouched
  and there is no reduced-motion clause to write.
- **The rail is `ProgressBar` at 56px**, from [117](117-menu-and-task-line.md),
  whose width prop exists for exactly these two callers. A search has no
  measurable progress, so the ratio counts the four steps to a drawn mapping —
  the files, the candidates, the tracklist, the mapping — and the sheet's 25%
  is the first of them. `opening` a quarter, `searching` a half, `fetching`
  three quarters. The status line names the step, the sheet's wording for the
  second: "Your files are already here · matching candidates".

**`index === null` stops meaning "show the table".** `openReview` opens on the
first row. Null is now only what a decided release leaves behind, and the pane
draws the prompt for it.

## The guard and the token

`gives a paned dialog one size and one scroller` bans `overflow` on every
`.lookup*` rule. It was written for a box whose height moved under the
pointer, and a column that scrolls inside a fixed track does not move it — the
count of scrollers was a proxy for the thing that mattered. So it is restated:
`.dialog.lookup` states a height, `.dialog.lookup > .dialog-body` overrides
the paned body's `overflow-y: auto` to `hidden`, and the two `.lookup*` rules
that scroll are named and must each declare `min-height: 0`. `overflow:
hidden` for truncation stays allowed — it is how the queue's album and the
mapping's titles ellipsise — and a sideways scroller still fails.

**`--row-line`** lands with it: a fourth and lightest border weight, on both
grounds. 6e draws two in one picture — the queue's column edge and its eyebrow
at the sheet's `separator`, the line between two rows a step under it — and
that difference is what makes a run of rows read as one block inside a frame.

Part of the [component library sweep](../../plans/apex-components.md).
