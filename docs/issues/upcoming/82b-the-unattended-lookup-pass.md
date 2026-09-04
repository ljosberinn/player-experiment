# 82b — The unattended lookup pass

[79b](../done/79b-online-release-lookup.md) is a dialog somebody opens. This is
the same lookup as a background pass: over what is already in the library once,
and over every release a scan adds from then on. Needs
[82a](82a-what-eight-thousand-releases-break.md) first, or it fires 8,045
re-queries and buries the undo journal.

**A reversal, deliberately.** [79b](../done/79b-online-release-lookup.md)
confirms every match by hand, and conventions calls the file the source of
truth. Both hold for *uncertain* matches. A release whose track count, track
order and per-track durations all agree with MusicBrainz is not a guess, and
confirming eight thousand of those by hand is not review, it is clicking.

## Opting in

**A Settings switch, off by default.** [79b](../done/79b-online-release-lookup.md)
calls this module outbound network that is inert unless somebody asks; the ask
is the switch, once, rather than per release. A `settings` key beside
`DYNAMIC_BACKGROUND` and the rest.

Once it is on the pass runs on launch and after every scan, over everything
`release_lookup` has no row for. The switch going off cancels a pass in flight.

## What it does per release

The release is the unit, keyed exactly the way the browse view groups —
`GROUP_ALBUM` and `GROUP_ARTIST` in `db::query`, empty strings folded to NULL
and all — because a release has to be the same thing here as it is in the grid.
`release_selections` already groups by those two expressions.

Two MusicBrainz calls, and there is no way to make it fewer: `search` for
candidates, then `fetch` on the best one, because per-track durations are the
half of the score that separates two pressings and they do not exist until a
tracklist does. **8,044 releases × 2 calls at 1/s is four and a half hours.**
That is the floor and no amount of concurrency moves it — the limiter is
process-wide by design, so an open dialog and the pass share the same second.

Covers are free: the Cover Art Archive has no rate limit and
`tagsource::fetch_release` already fetches one beside the tracklist rather than
after it.

- **Above the threshold**, the write happens: title, artist, album, album
  artist, year, track and disc number, both MBIDs, the release type
  ([83a](83a-where-a-file-goes.md)'s column and field, written here because this
  is what writes the rest of the release's identity), and artwork where there is
  none.
- **Below it**, nothing is written and the release goes in the review queue for
  [82c](82c-the-review-queue-and-progress.md).
- **No candidates at all** leaves the file exactly as it is and is not queued —
  there is nothing for the user to decide.
- **Genre is filled, never overwritten**, and comment is never touched.
  MusicBrainz genre data is thin and inconsistent next to a library tagged by
  hand; only 2,128 of 65,535 tracks are missing one.

### Two things the write needs that do not exist yet

- **There is no genre to fill with.** `RELEASE_INC` is
  `recordings artist-credits release-groups` and `ReleaseDetail` has no genre
  field, so "genre is filled" cannot happen until `genres` joins the `inc` and
  the model. `TagEdit`'s absent-means-leave-alone is what makes *never
  overwritten* one line at the call site.
- **Artwork is a staged temp file**, the same `CoverEdit::Replace` path
  `tagsource_fetch` writes through. Over 8,044 releases that is 8,044 JPEGs in
  the staging directory unless each one is cleaned after its write, and it must
  not stage at all for a release that already has a cover.

## The threshold

**A constant beside `tagsource::score`, not a setting.** The score is an opaque
0-to-1 and a slider is a control nobody can aim; a number that has to be tuned
against a real library is a number to tune once, in the open, with the reasoning
next to it.

*Open:* the number. `WITH_DURATIONS` is `(0.45, 0.25, 0.30)`, so a perfect track
count and perfect durations are already 0.55 before any text agreement, and a
MusicBrainz search score of 90 carries it to 0.955. The bar is therefore
somewhere near 0.93–0.95 — but that is arithmetic, not evidence. Pick it by
running the pass over this library in a mode that reports what it *would* write
and writing nothing, then reading the disagreements. That mode is a testing
affordance, not a feature, and it does not need UI.

## `release_lookup`

One row per release key, whatever migration number is next when this lands. It
is the review queue, the resume point and the idempotence guard in one table.

- The two key columns, matched with `IS` the way `release_members` does, so an
  untagged release matches on NULL. **A `PRIMARY KEY (album, artist)` will not
  do**: SQLite permits NULLs in a rowid table's primary key, so an untagged
  release inserts twice. A UNIQUE index over
  `coalesce(album, ''), coalesce(artist, '')` is what actually holds.
- Status — resolved, review, or nothing-found. No row means never attempted.
- The chosen MBID, the score, and when it was last attempted.
- **A release whose files all already carry a release MBID is resolved without
  a call**, seeded from the tags [79a](../done/79a-per-track-edits-and-the-release-mbid.md)
  taught `tags::read` to keep. A re-install or a rescan of an already-tagged
  library should not pay four and a half hours again.
- **Retagging invalidates by itself.** Change the album or the artist and the
  key changes, so the release reads as unattempted and gets looked up again.
  That is the wanted behaviour and it costs nothing to get.

*Open:* whether nothing-found is ever retried. MusicBrainz grows, so today's
miss is next year's match — but a pass that re-searches every miss on every
launch is 4.5 hours that finds nothing, forever. Recommendation: never
automatically; a manual re-look-up belongs to
[82c](82c-the-review-queue-and-progress.md) or later.

## The worker

**Not `commands::blocking`.** That helper wraps a command that returns when its
work finishes, and a four-and-a-half-hour command is not that. The shape is
`scan::watch::spawn`'s: a named thread owning a `Db` handle and a cancel flag,
started from `lib.rs`, joined by nobody.

- **Cancellable**, and it resumes from `release_lookup` on the next start rather
  than beginning again.
- **The `ScanLock` is taken per write, not for the pass.** It rewrites the files
  a scan reads its `(mtime, size)` from, so the write has to be behind it — but
  holding it for four and a half hours would block every scan in that window.
- One log line per release it resolves or queues, and silence for a miss. 8,044
  lines is nothing next to a bad threshold that cannot be diagnosed after the
  fact.

Testing: recorded fixtures through `FakeTransport`, so the whole pass runs with
no network. The threshold asserted on both sides of itself; a release with no
candidates asserted untouched and unqueued; genre asserted filled and asserted
*not* overwritten; comment asserted untouched; the table asserted to make a
second pass a no-op; and a pass killed mid-way asserted to resume where it
stopped rather than from the top.
