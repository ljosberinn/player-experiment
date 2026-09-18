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

## Changes

- `lookup::Queued` gains `score: Option<f32>` (drop its `Eq` derive), read with
  the awaiting rows. `queue` sorts its result by score descending, NULL last;
  a stable sort keeps artist/album order within a tie.
- `ReviewEntry` gains `score: number | null`. `npm run bindings`.
- Store: `index` becomes `number | null`, null meaning the table. `openReview`
  lands on null and does not `enter`; a new `choose(index)` enters a row.
- On the review queue, Apply and Set Aside take the entry out of the local
  queue and return to the table; the last one closes the dialog. Skip becomes
  **Back to Queue**. `release N of M` in the title goes on this queue.
- Columns: Match, Album, Artist, Tracks (`trackIds.length` / best candidate's
  `trackCount`), Best Match (`describe` of `candidates[0]`, empty where the
  cache is gone). Rows activate on click and Enter. No column sorting.
- About 400 rows: a plain `<table>`, no virtualisation. It goes in
  [89](89-the-lookup-window-stops-resizing.md)'s scrolling body if 89 has
  landed.

Testing: Rust — `queue` returns rows by score descending with NULL last, ties
in artist/album order. Store — `openReview` lands on the table; `choose` enters;
Apply and Set Aside remove the row and return; the last one closes. Component —
the table renders in score order and a row click opens that release. No e2e:
only the pass writes these rows (see
[82c](../done/82c-the-review-queue-and-progress.md)).
