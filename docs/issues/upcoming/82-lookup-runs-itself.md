# 82 — Lookup runs itself

[79](79-online-release-lookup.md) is a dialog somebody opens. This is the same
lookup as a background pass: over what is already in the library once, and over
every release a scan adds from then on.

**A reversal, deliberately.** 71 says never automatic and never bulk-applied
unreviewed, and conventions calls the file the source of truth. Both hold for
*uncertain* matches. A release whose track count, track order and per-track
durations all agree with MusicBrainz is not a guess, and confirming eight
thousand of those by hand is not review, it is clicking.

- **Above the threshold**, the write happens. Title, artist, album, album artist,
  year, track and disc number, release MBID, and artwork where there is none.
- **Below it**, nothing is written and the release goes in a **review queue**.
  The dialog from 71 opens on a queue entry with the candidates already fetched.
- **No match at all** leaves the file exactly as it is and is not queued —
  there is nothing for the user to decide.
- **Genre is filled, never overwritten**, and comment is never touched.
  MusicBrainz genre data is thin and inconsistent next to a library that has
  been tagged by hand; only 2,128 of 65,535 tracks are missing one.

Migration 12, `release_lookup`: one row per release keyed the way
`db::query` groups the browse view, carrying status, the chosen MBID, the score
and when it was last attempted. It is the review queue, the resume point and the
idempotence guard in one table — a second pass skips anything already resolved.

**The first pass takes four and a half hours.** 8,045 releases × 2 MusicBrainz
calls at 1/s. That is the floor, and no amount of concurrency moves it. So it is
a worker thread through `commands::blocking`, cancellable, and it resumes from
`release_lookup` on the next start rather than beginning again. Covers come from
Cover Art Archive, which has no rate limit, so those fetch in parallel and never
gate the queue.

**The progress readout goes at the bottom of the sidebar**, below the playlist
sections, where there is space. Percentage to two decimals and an estimate from
the last 100 releases. [83](83-the-library-folder.md) has a second long task and
reuses it, so build it as one component fed by a task, not as this task's own.

Two things bite at this volume and neither is visible at ten:

- **`library://changed` per commit is 8,045 pings** and every view re-asks on
  each. Coalesce them; the channel is one ping with no payload, so a throttle
  costs nothing and loses nothing.
- **`tag_undo` gains a row per track**, so a first pass leaves 65,535 of them
  and nothing trims the journal. Cap it to the last N batches here — a one-line
  delete — or the table is unbounded from this phase on.
