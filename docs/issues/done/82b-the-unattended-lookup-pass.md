# 82b — The unattended lookup pass

[79b](79b-online-release-lookup.md) is a dialog somebody opens. This is
the same lookup as a background pass: over what is already in the library once,
and over every release a scan adds from then on. Needs
[82a](82a-what-eight-thousand-releases-break.md) first, or it fires 8,045
re-queries. [82a — Undo goes](82a-undo-goes.md) removes the undo
journal, so nothing here has to decide whether the pass journals what it writes.
What protects the user from a bad automatic write is the threshold below and
82c's review queue.

**A reversal, deliberately.** [79b](79b-online-release-lookup.md)
confirms every match by hand, and conventions calls the file the source of
truth. Both hold for *uncertain* matches. A release whose track count, track
order and per-track durations all agree with MusicBrainz is not a guess, and
confirming eight thousand of those by hand is not review, it is clicking.

## Opting in

**A Settings switch, off by default.** [79b](79b-online-release-lookup.md)
calls this module outbound network that is inert unless somebody asks; the ask
is the switch, once, rather than per release. A `settings` key beside
`DYNAMIC_BACKGROUND` and the rest.

Once it is on the pass runs on launch and after every scan, over everything
`release_lookup` has no row for. A scan needs no signal to make that happen: the
releases it adds have no row, so the next sweep finds them. The switch going off
cancels a pass in flight.

**Not exportable.** The allowlist in `db::settings` excludes it by default and
it stays excluded: opting a machine into outbound network is a decision about
that machine, not a preference an exported library carries to the next one.

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
  ([83a](../upcoming/83a-where-a-file-goes.md)'s column and field, written here because this
  is what writes the rest of the release's identity), and artwork where there is
  none.
- **Below it**, nothing is written and the release goes in the review queue for
  [82c](../upcoming/82c-the-review-queue-and-progress.md).
- **No candidates at all** leaves the file exactly as it is and is not queued —
  there is nothing for the user to decide.
- **Genre is filled, never overwritten**, and comment is never touched.
  MusicBrainz genre data is thin and inconsistent next to a library tagged by
  hand; only 2,128 of 65,535 tracks are missing one.

### Three things the write needs that do not exist yet

- **There is no genre to fill with.** `RELEASE_INC` is
  `recordings artist-credits release-groups` and `ReleaseDetail` has no genre
  field, so "genre is filled" cannot happen until `genres` joins the `inc` and
  the model. `TagEdit`'s absent-means-leave-alone is what makes *never
  overwritten* one line at the call site.
- **There is no release type either, and it is 83a's.** The column
  `tracks.release_type`, the `tags::read` fill from
  `ItemKey::MusicBrainzReleaseType` and `primary-type` on `ReleaseGroup` move
  here, because this is the phase that writes them; 83a keeps the path builder
  that reads them. Unlike the genre this needs no `inc` change —
  `release-groups` already returns the type. Unlike the two MBIDs it needs no
  `MUSICBRAINZ_TXXX` entry either: lofty 0.25's ID3v2 conversion has an arm for
  this key and writes it as TXXX without being told to.
- **Artwork is a staged temp file**, the same `CoverEdit::Replace` path
  `tagsource_fetch` writes through. Over 8,044 releases that is 8,044 JPEGs in
  the staging directory unless each one is cleaned after its write, and it must
  not stage at all for a release that already has a cover. Its own file rather
  than `tagsource_fetch`'s fixed staging name, or a pass would overwrite the
  artwork an open tag editor is previewing.

## The threshold

**A constant beside `tagsource::score`, not a setting.** The score is an opaque
0-to-1 and a slider is a control nobody can aim; a number that has to be tuned
against a real library is a number to tune once, in the open, with the reasoning
next to it.

*Settled:* **0.93, provisional.** `WITH_DURATIONS` is `(0.45, 0.25, 0.30)`, so a
perfect track count and perfect durations are already 0.55 before any text
agreement, and a MusicBrainz search score of 90 carries it to 0.955 — which puts
the bar near 0.93–0.95. That is arithmetic, not evidence, so the number ships at
the permissive end of it and the mode that produces the evidence ships beside
it: `APEX_LOOKUP_DRY_RUN` runs the whole pass, logs the verdict it would reach
per release and writes nothing, neither files nor rows. An environment variable
because it is a testing affordance rather than a feature — no command, no
setting, no UI.

## `release_lookup`

One row per release key, whatever migration number is next when this lands. It
is the review queue, the resume point and the idempotence guard in one table.

- The two key columns, matched with `IS` the way `release_members` does, so an
  untagged release matches on NULL. **A `PRIMARY KEY (album, artist)` will not
  do**: SQLite permits NULLs in a rowid table's primary key, so an untagged
  release inserts twice. A UNIQUE index over
  `coalesce(album, ''), coalesce(artist, '')` is what actually holds — **and
  both sides of it collate `NOCASE`**, because `release_members` matches that
  way and the grid folds case since 81. Unfolded, a release tagged two ways is
  one tile and one member list but two lookup rows, and the second row pays the
  four and a half hours again.
- Status — resolved, review, or nothing-found. No row means never attempted.
- The chosen MBID, the score, and when it was last attempted.
- **The candidates of a queued release, as JSON.** 82c's dialog opens on the
  results step, and the pass has the list in hand at the moment it queues; the
  alternative is a rate-limited second per entry at review time. A cache, not a
  record — 82c still offers Search again.
- **A release whose files all already carry a release MBID is resolved without
  a call**, seeded from the tags [79a](79a-per-track-edits-and-the-release-mbid.md)
  taught `tags::read` to keep. A re-install or a rescan of an already-tagged
  library should not pay four and a half hours again.
- **Retagging invalidates by itself.** Change the album or the artist and the
  key changes, so the release reads as unattempted and gets looked up again.
  That is the wanted behaviour and it costs nothing to get.

*Settled:* **nothing-found is never retried automatically.** MusicBrainz grows,
so today's miss is next year's match — but a pass that re-searches every miss on
every launch is 4.5 hours that finds nothing, forever. A manual re-look-up
belongs to [82c](../upcoming/82c-the-review-queue-and-progress.md) or later, which is why
`attempted_at` is stored now.

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
