# 90 — Pair files to a tracklist by what they are

`defaultAssignment` in `src/features/tagsource/mapping.ts` has two modes and
neither one looks at a title or a duration. Every file numbered: pair on
`(track_no, disc_no ?? 1)`. Any file unnumbered: pair on position, for the
whole release.

The review queue is the population where those two keys are least worth
trusting — a release is queued precisely because its tags did not agree with
MusicBrainz well enough for the pass to write it unasked.

Measured over this library's queue as it stands, 41 entries and 307 files, the
pass having worked as far as `A`:

- **5 entries are one file with no album and no track number.** Positional, at
  index 0, so the file is paired with the candidate's first track whatever it
  is called and however long it is.
- **6 entries carry at least one unnumbered file**, which drops the whole
  release to positional even where most files are numbered — `Highway To Hell`
  is 13 files with 2 of them unnumbered. The rows arrive in `RELEASE_ORDER`,
  `coalesce(disc_no, 1), track_no, path`, and a NULL `track_no` sorts first in
  SQLite, so those 2 are listed and paired *above* track 2.
- **2 entries repeat a track number within the release** — a multi-disc set
  flattened into one folder whose `disc_no` was never written, so `disc(null)`
  folds both discs onto disc 1. `taken` then leaves the second disc's files at
  `null`, "Nothing to write", while the tracklist holds the same title at the
  same length. `Le secret` by Alcest is 6 files over 4 distinct numbers.
- **16 entries are a partial selection numbered into a gap** — `The Razors
  Edge`, 7 files numbered 1 to 12. That is the case the track-number branch
  exists for, and it is right whenever the numbers agree with the candidate's.
  Nothing checks whether they do.
- **All 41 have a duration on every file.**

The one signal that is always present is the one the pairing declines to read.

## Score every pair, take the best

Both sides carry a title and a length — `Track.title` and `Track.duration_ms`
against `RemoteTrack.title` and `RemoteTrack.durationMs`. Score each (file,
remote track) pair over duration closeness, title similarity and track-number
agreement, then take pairs best-first with each file and each remote track used
once. Neither side exceeds sixty entries, so an O(n²) sweep is free and there is
no reason to reach for anything cleverer.

**A pair below a floor stays `null`.** The row already reads "Nothing to write"
and the arrows already repair it. A wrong pairing is worse than no pairing,
because the wrong one is the one somebody applies without reading it.

**The duration thresholds are `score.rs`'s**: `EXACT_MS` at 2,000 and
`TOLERANCE_MS` at 30,000 with the same linear slope between, for the reasons
its comments give — encoders disagree by a frame, MusicBrainz rounds lengths to
the second, half a minute is a different mix of the same song. Two constants
restated across the boundary are cheaper than a round trip to compute a mapping
the page already holds both sides of; the comment says where they came from.

**The track number stays the strongest single signal and stops being the only
one.** A release whose numbers agree with the candidate's must pair exactly as
it does today. What changes is that disagreement now has somewhere to go
instead of producing a silent off-by-one or a column of `null`.

## What this is not

**Not the unattended pass's score.** `score.rs::duration_agreement` zips the
two duration lists positionally and says so — it scores the mapping the dialog
offers, and a score computed over some other pairing would measure an apply
that never happens. Making it order-insensitive changes which of some 8,000
releases the pass writes without asking, which is a decision about
`UNATTENDED_THRESHOLD` and belongs to a phase that can measure it with
`APEX_LOOKUP_DRY_RUN`.

**Not the row order**, which is cosmetic once the pairing is by content. One
line of it is still worth taking: `RELEASE_ORDER` hoisting unnumbered files
above track 2 makes the arrows harder to aim, and `tracks.track_no IS NULL`
ahead of `tracks.track_no` is the whole change.

It touches `mapping.ts` and nothing else, so it runs in a worktree beside
[89](89-the-lookup-window-stops-resizing.md), which touches the component.

Testing: `mapping.test.ts` — a release whose numbers agree asserted to pair as
it does today; a flattened two-disc set with duplicate numbers asserted to pair
on duration and title rather than leaving the second disc unmapped; one
unnumbered file among twelve asserted not to drop the other eleven to position;
two tracks of the same length asserted to be told apart by their titles; a file
the release genuinely has nothing for asserted to stay `null`; twelve untitled
files of identical length asserted to fall back to position rather than to an
arbitrary pairing.
