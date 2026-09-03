# 82d — The pass cannot finish

Found by running [82b](../done/82b-the-unattended-lookup-pass.md) over the real
library for four minutes. It surveyed 54 of 8,006 releases and then surveyed the
same 54 again, four times, while MusicBrainz answered 503 six times. Two
independent defects, either of which alone stops the pass getting through the
library.

## The dry run has no cursor

`lookup::pending` returns releases with **no row in `release_lookup`**, and a dry
run writes no rows — so it restarts at the alphabetically first release every
sweep, forever. `Ghost — (((S)))` was looked up four times in four minutes.

That defeats what the mode exists for. The threshold is meant to be picked by
reading what a pass over *this* library would write, and the mode can only ever
report on its first batch.

**Rows are the right cursor for a real pass and cannot be the cursor for a dry
one.** So `pending` gains an offset and the dry run pages with it. A real pass
keeps using rows, which is what makes it resumable across a quit; a dry run is
one survey in one process and has nothing to resume.

`seed_from_tags` runs in both modes and is the reason there is one row in the
table after a dry run. It goes behind the same check.

## One 503 ends the sweep

Six in four minutes, each ending the sweep where it stood — the longest got 54
releases in, the shortest one.

**The limiter has no headroom.** Sweep 2 made 90 requests in 93 seconds: the
limiter is doing exactly what it was built to do, and that is the problem. One
request per second measured locally is more than one per second measured at
their end as soon as the network jitters.

**Nothing retries.** `TransportError::transient()` is `true` for a 503 and, in
`tagsource`, is referenced only by its own tests — `musicbrainz::network()`
flattens the error into `AppError::Internal(String)`, so by the time it reaches
the pass there is nothing left to branch on. The pass then treats every `Err` as
a reason to stop.

- **Headroom in `rate::INTERVAL`.** 1.1s costs 27 minutes over 8,044 releases and
  buys the margin the limit needs. It is shared, so an open dialog pays it too.
- **Keep the error type across `musicbrainz`.** Whatever the shape, the pass has
  to be able to ask whether asking again could work.
- **Retry a transient failure before giving up on it.** Twice, backing off, then
  end the sweep as now.

*Open:* whether a 503 should end the sweep at all once retries are exhausted, or
skip the release and carry on. Ending it is right if the cause is "this address
is being throttled" and wrong if it is one bad release. Recommendation: end it —
a throttled address is by far the likelier cause, and the next tick is fifteen
seconds away.

## A dry run does not say it was one

`status=written` is byte-identical whether the pass wrote the files or only
decided it would. For the one feature in the app that writes tags nobody
approved, the log has to say which happened.

## `enabled()` reads a failure as "off"

`db.conn().and_then(…).unwrap_or(false)` in `worker::spawn`, called before every
release, opening a connection each time. A database busy for a moment ends the
pass, and the log cannot tell that from the user flipping the switch.

## What the scores said, for whatever 54 releases are worth

Not enough to move the number on — one artist dominates the sample — but the
shape around the bar, and the reason 82d has to land before the threshold can be
settled:

| | score | |
| --- | --- | --- |
| lowest written | 0.936 | Shine Black Algiz — 2 tracks |
| | 0.939 | My Black Fate — 2 tracks |
| **the bar** | **0.930** | |
| highest queued | 0.921 | Sol Ek Sa — 1 candidate |
| | 0.914 | Liberation — 1349, 6 candidates |

Both near-misses look like genuine albums, which argues the bar is high. Both
lowest writes are two-track releases, where agreeing on two durations is thin
evidence, which argues it is low. 8,006 releases decide it; 54 cannot.

**A third of them found nothing at all** — 18 of 54 `missed`, against a library
whose releases are mostly real records with real names. Worth understanding
before the threshold, because a miss is not a scoring problem: it is a query
that found no candidate, and `query_for` builds that query from two tags.

Testing: a sweep asserted to reach the second batch in dry-run mode over a
library with more releases than one batch holds — which is the assertion whose
absence let this ship. A transient failure asserted retried and a permanent one
asserted not. A dry-run sweep asserted to leave `release_lookup` empty,
`seed_from_tags` included.
