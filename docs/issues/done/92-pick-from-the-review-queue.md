# 92 — Pick from the review queue

`openReview` opens the lookup dialog straight on entry 0, and the queue is in
`lookup::queue`'s scan order — artist, then album. There is no way to see what
is queued or to start with the likeliest matches.

The review queue opens on a table of every queued release instead, sorted by
match descending. Clicking a row opens the per-release step exactly as today.
A lookup opened from a selection is unchanged: it has no scores before it
searches, and it still starts on its first release.

## The score

`release_lookup.score` is already written for every `review` row and never
leaves the database. It is the number the pass decided on — the fetched best
candidate, with durations — so it is what the table shows and sorts by.

It is not the top percentage the per-release results show: those are the
cached search scores, without durations. A row reading 88% can open on a
result list whose first entry reads 91%.

A row can sit above the 0.93 bar: `pass.rs` also queues a release whose track
count disagrees. So the table carries a Tracks column, local against the best
candidate, and that is what says why a 97% is in the queue.

The Tracks column's remote number is `candidates[0].trackCount`, which
`musicbrainz.rs` takes from the search response — the pass compared the
*fetched* tracklist's length. The same class of discrepancy as the score above,
and it is a display column either way.

`score` is nullable because the column is, not because a queued release has no
score: `record` always writes one for `review`. NULL last is what stops a row
the schema allows from sorting to the top.

## Changes

- `lookup::Queued` gains `score: Option<f32>` (drop its `Eq` derive), read with
  the awaiting rows. `queue` sorts its result by score descending, NULL last.
  `sort_by` is stable, so artist/album order survives a tie for free.
- `ReviewEntry` gains `score: number | null`. `npm run bindings`.
- Store: `index` becomes `number | null`, null meaning the table. `openReview`
  lands on null and does not `enter`; a new `choose(index)` enters a row, and
  `close` resets to null.
- On the review queue, Apply and Set Aside take the entry out of the local
  queue and return to the table; the last one closes the dialog. Skip becomes
  **Back to Queue**. `release N of M` in the title goes on this queue.
- **A lookup opened from a selection keeps every one of those**: `index: 0`,
  Skip Release advancing to the next release, `release N of M` in the title.
  There is no table behind it to go back to.
- The table view's chrome is its own: the title is the release count, there is
  no `.lookup-subject` — it names one release — and Cancel is alone in the
  action row, because Set Aside and Skip act on a release that is not open.
- Columns: Match, Album, Artist, Tracks (`trackIds.length` / best candidate's
  `trackCount`), Best Match (`describe` of `candidates[0]`, empty where the
  cache is gone). Rows activate on click and Enter, as `SongRow` does it —
  `<tr tabIndex={0}>` rather than a control per cell. No column sorting.
- About 400 rows: a plain `<table>`, no virtualisation. It goes in
  [89](89-the-lookup-window-stops-resizing.md)'s scrolling body.

Testing: Rust — `queue` returns rows by score descending with NULL last, ties
in artist/album order. Store — `openReview` lands on the table; `choose` enters;
Apply and Set Aside remove the row and return; the last one closes; a selection
still advances. Component — the table renders in score order and a row click
opens that release. No e2e: only the pass writes these rows (see
[82c](82c-the-review-queue-and-progress.md)).
