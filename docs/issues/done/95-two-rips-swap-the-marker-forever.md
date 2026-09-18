# 95 — Two rips swap the marker forever

Three releases are re-placed every 15 s, forever, and unlike
[94](94-a-folder-the-case-fold-cannot-see.md) these move real files. From
`%APPDATA%\dev.ljosberinn.apex\main.log`, one sweep of 2,080 identical ones:

```text
2026-09-18T19:54:02Z ok  library.place   album=Nordavind artist=Storm status=moved files=17 covers=0 skipped=0 ms=31
2026-09-18T19:54:02Z ok  library.place   album=Strid artist=Strid status=moved files=15 covers=0 skipped=0 ms=30
2026-09-18T19:54:02Z ok  library.place   album=Loss artist=Wodensthrone status=moved files=12 covers=0 skipped=0 ms=31
2026-09-18T19:54:02Z ok  pass.sweep      visited=9 resolved=0 queued=0 missed=0 placed=9 deferred=0 unmovable=0 failed=0 retries=0 run=0 next=15s ms=658
```

`files=` is every row of the release, every pass. The last sweep in the log is
`2026-09-18T22:25:33Z`, and all three album folders were created at that
instant — `D:\Library\Storm\Nordavind - 1994 - Album` has ctime == mtime ==
`2026-09-19 00:25:33` local, UTC+2. Every pass deletes the folder and makes a
new one under the other name.

Each of the three holds two rips merged into one release: pairs of rows with the
same `track_no` and title, one file wearing ` (2)`, and **the pair disagrees
about the year**.

```text
52714  1995  D:\Library\Storm\Nordavind - 1994 - Album\01 - Innferd (2).mp3
52715  1994  D:\Library\Storm\Nordavind - 1994 - Album\01 - Innferd.mp3
```

Strid is 1994/2007 in a `- 2007 -` folder, Wodensthrone 2009/2010 in a
`- 2010 -` folder.

## Why

1. [`mover::shape`](../../../src-tauri/src/library/mover.rs#L269) takes the year
   from the first row that has one, in
   [`RELEASE_ORDER`](../../../src-tauri/src/db/query.rs#L475) —
   `(disc_no, track_no, path)`. `" ("` sorts before `"."`, so **the marked file
   names the folder**: Storm resolves to 1995, Strid to 1994, Wodensthrone to
   2009, none of them the folder they are in. Every file mismatches, so every
   file moves.
2. In the new year folder no row owns anything yet, so
   [`free_target`](../../../src-tauri/src/library/mover.rs#L303) gives the
   plain name to the first file in order — the one currently wearing the marker
   — and ` (2)` to its partner. The marker changes hands.
3. Next sweep the marker sits on the other year, so the folder resolves back.
   Files swap names again. 15 s, forever.

[82m](82m-a-marker-only-survives-while-held.md) made a marker legible to
the survey by having
[`earns_its_marker`](../../../src-tauri/src/library/survey.rs#L164) reproduce
`free_target`'s choice. It does reproduce it — for a folder that does not move.
A renamed folder puts every name back up for grabs.

## Shape

Two independent halves; either alone leaves a loop.

- **The year may not depend on path order.** The marker is a property of where
  the file already sits, so a folder name derived through it is derived through
  itself. Most common year across the release, lowest on a tie.
- **A marker stays with the row that wears it.** `free_target` hands out names
  by iteration order, which is stable only while the folder is. Seed `taken`
  from what each row already wears when the source and target folders differ,
  so a release moving as a unit carries its numbering along.

`(2)` here is a real duplicate rip, not a collision between releases —
deduplicating is not this.

**No migration.**

## Tests

- A release whose rows disagree about the year resolves to one folder, and
  resolves to the same one after it has been moved into it.
- Moving a release with a ` (2)` file to a new folder leaves the marker on the
  same row.
- Two sweeps in a row over such a release: the second moves nothing.
- The existing collision case — two different releases sanitizing to one name —
  still numbers the second one.

No screenshots — nothing visible changes.
