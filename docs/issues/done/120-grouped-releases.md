# 120 — A drill-in drawn as release groups

Section 03's 3f, marked *Selected*. It replaces the **drill-in** — all three of
them — not the cover grid. The grid, the breadcrumb and the per-tab scroll
memory all stay.

3f is a list, not a card: the sheet draws it as `<sc-for list="{{ groups }}">`
with two placeholder groups on both grounds. So a drill-in into an artist or a
genre is the drawing's real subject — today those are a flat `SongTable` with no
release boundaries, no covers and a default sort of `artist`, which inside one
artist says nothing, the same objection `sortForEntry` already records against
albums. A release drill-in is the same component with one group, and it is the
first thing that names the release: the heading is suppressed while `browse` is
set and the breadcrumb reads only "‹ All Releases".

- Group is `168px 1fr`, `16px` gap, `14px 12px` padding, separated by a 2px
  rule.
- Gutter: a 52px cover, then album `800 12.5px/1.25`, year and format each
  `400 11.5px/1.35` muted.
- Table side: rows are 28px, `0 6px` padding, `10px` gap.
- Closing row: 1px top border at 45% grey, `opacity: .72`, `600 11.5px`, song
  count left and total duration right.

## The columns stay

3f draws number, title and duration, and that is the specimen frame rather than
a decision. Every drawing in the sheet sits in `repeat(2, minmax(440px, 1fr))`.
Minus the 168px gutter, the 16px gap and 24px of padding the table has ~232px,
and `24px 1fr 46px` with its gaps and padding spends 102 of them — three columns
is what 232px fits. The sheet closes by asking for *"take 3f to full width with
all seven columns"*, which keeps the gutter and the grouping and widens the
table.

So `ColumnHeader`, `columnFit` and the stored layout stay. One header above the
groups rather than one per group: the gutter is a fixed 168px, so every group's
table starts at the same x and the header is that inset. Sorting becomes
within-group — `ORDER BY <release ordering>, <sortBy>` — which is what a sort
means once the view is grouped.

## Rows come from the group list, not from the rows

The drill-in query is ordered by release first, so consecutive rows share one,
and the boundaries are a prefix sum over the release groups' `trackCount`. Group
`i` owns rows `[offset_i, offset_i + count_i)`; its height is closed-form and
must not be measured — `28n + 58`, from `14 + 14` padding, `(n + 1) × 28` for
the rows and the footer, and the 2px rule. The 52px gutter never wins for
`n ≥ 1`. So the virtualizer runs over groups, `ensureRange` and the page cache
are untouched, and nothing waits on a row to know where a group starts.

**The two orderings have to agree exactly.** `browse_groups` orders by
`group_key IS NULL, group_key, group_secondary, group_id`; the track query's
outer term must be the same expression list or the prefix sum indexes the wrong
rows. Inside a drill-in the release groups order by year then title instead — a
discography is chronological — and the track query follows that.

## What the backend owes

- **`browse_groups` must respect a browse filter.** It strips `browse` on
  purpose, so the list of albums is not filtered by the album already open. A
  drill-in asks a different question — which releases are inside *this* artist —
  and needs the filter kept and the kind free.
- **The gutter's format line.** There is no format anywhere: not on `Track`, not
  on `BrowseGroup`, and `tracks` carries only `bitrate` and `sample_rate`.
  `AUDIO_EXTENSIONS` is `["mp3"]`, so a stored format column would print one
  constant string for every release until that list widens. The line is the
  extension word off `tracks.path` plus the group's mean `bitrate` — "MP3 · 320
  kbps", and the word alone where a group's extensions disagree. The CASE arms
  are generated from `AUDIO_EXTENSIONS` so the two cannot drift.

## The group is found by id, not carried in

`browse_groups` already runs inside a drill-in and is already narrowed by the
same search, so the counts match the rows. But the group cannot be handed over
from the tile that was clicked: `back` and `forward` replay a `HistoryEntry`
carrying only `{kind, id}` and a label, and `showTrackGroup` builds one from a
`Track`. It is looked up by id — **folding case**, because `entryForTrack`
builds `browse.id` in JS while the identity is compared `COLLATE NOCASE`.

## What goes

The closing row restates the status bar when a drill-in holds one group —
`viewSummary` already prints the count and the duration for the open query. It
stays anyway: it is per group, and at `n = 1` the two coincide by arithmetic
rather than by saying the same thing.

Rows still do not light up under the pointer. The sheet draws a hover veil on
3f; `App.css.test.ts` fails the build for one, on purpose, and 114 left that
standing.

Part of the [component library sweep](../../plans/apex-components.md).
