# A write nobody checked

`pass::look_up` calls `tags::write::apply` and drops what it returns. `apply`
only errors on a batch it refused outright, so a release whose every file
failed comes back as a `Written` with `failed` equal to the tracklist, and the
pass goes on to record `Status::Resolved` and log `status=written`.

Nothing here corrupts a file or a row: `sync_row` runs only over files that
were written, so `tracks` keeps what the disk has. The damage is
`release_lookup`. Nothing ever clears a row and `pending` returns only
releases with none, so a release resolved this way is never looked up again.

Observed: the library's drive was unplugged from 2026-09-19 18:53Z to
2026-09-20 01:11Z, and the pass recorded 344 releases — about 3,400 files — as
resolved with nothing written. Those rows have been deleted by hand. Around 93
more, spread across every earlier pass, are the same thing at the per-file
scale: a frame lofty would not encode, a file another process held open.

## The two failures are not one failure

A file that is not there will be there tomorrow. A file that will not take a
`COMM` frame will not take it tomorrow either, and re-searching it every sweep
is two MusicBrainz calls a release, forever — the cost `release_lookup` exists
to avoid.

`write_file` already knows which it has: the copy is the first touch of the
file, and an `io::Error` there that is `NotFound`, or Windows' 21, is a path
that is not currently reachable. Everything else is a file that is there and
refused.

So:

- any file unreachable → record no row, and the next sweep tries it again
- otherwise any file refused → a new `unwritable` status, carrying the mbid and
  the score, out of the search loop and not claiming to be resolved
- everything written → `resolved`, as now

Partial counts as refused: the release is split across two identities and
calling that resolved is the same lie in a smaller size.

The log line says which, and carries the counts — a `status=written` that could
mean nothing was written is what made this invisible for two weeks.

## The rows already written

Migration 17 widens the status CHECK, and deletes every `resolved` row whose
`release_mbid` is on no track. That is the same evidence the window above was
found with: `sync_row` runs only over files that were written, so a release the
pass really did write carries its mbid on at least one row.

Deleted rather than restated as `unwritable`, because which of the two it was
is not knowable after the fact — the drive that was out for an evening and the
file that will refuse forever look identical in this table. One lookup apiece
settles it.

## Not done here

`unwritable` reaches the log and `pass.sweep`'s counts and nothing else. A
release the library cannot be made to carry its identity is arguably worth a
surface, and the review queue is the wrong one: it asks a question that has
already been answered.
