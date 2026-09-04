# 82h — A move that moved nothing is counted, and the tail moves nothing

`mover::move_release` returns `Done(Moved::default())` when `release_files`
finds none, and `visit` counts `placed += 1` on `Done`. Nothing distinguishes a
release that was filed from one whose name matched no rows.

**The tail is where it happens.** `visit` refreshes the album and artist into a
local after a lookup writes them, and the deferral carries `pending` — which
still names the release under its pre-lookup tags. So a release the mover
deferred while the player held a file of it open is moved, in the tail, under a
name nothing carries: no files are found, `placed` goes up by one, and the
release is left where it is until the next sweep.

Two things, and the second is the reason it is worth fixing rather than
counting:

- `Done(Moved::default())` is not a placement. Either `move_release` says so or
  `visit` reads `moved.files` before counting.
- The tail has to move the release under the name it has now. `Visit::Deferred`
  carrying the refreshed `lookup::Release` is the smallest way to say it.

Found while reading [82g](../done/82g-a-503-defers-the-release.md), which fixes
the double lookup on the same line and leaves this.

Testing: a release deferred by the mover after a lookup rewrote its tags,
asserted to be moved by the tail; a move that finds no files asserted not to
count as a placement.
