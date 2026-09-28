# 179 — The player bar says when you last heard it

Under the artist in `NowPlaying`, muted: `56 plays · last played 3 days ago`.
The date links to Statistics › Listening, drilled into that day.

- **As of the load, not live.** `NowPlayingStatus` keeps the track's
  `play_count` and `last_played_at` as the song loaded, the plays before this
  one. Every pause, seek or volume step re-reads the row (`playback::snapshot`),
  and once `mark_played` has run that row says today.
- Never played: `First play`, no link.
- Relative wording, in local calendar days: `today`, `yesterday`, `n days ago`
  to 30, then the date as `periodLabel` spells a day. The tooltip gives the
  date and time.
- **The link:** `showLastPlay(last_played_at)` in `stats/lastPlay.ts` opens
  `lastPlayPath` — Listening with a `<YYYY-MM-DD>/day` period crumb — after
  resetting the Listening filters (range, owned, loved): a stored range narrows
  an older day to nothing, and *Owned* or *Loved* can hide the song. The
  Library tab's filters stay. `useStatsStore.load` now reads the stored filters
  once per session, so the view's read on opening cannot restore the old set.
  [180](180-the-row-menu-goes-to-the-last-play.md) links the same
  way and words its hint with `lastPlayedWords`.
- `last_played_at` is when a play counted; the log dates it by its start. A
  play that crosses midnight links to the day after.

## Tests

- Unit: the wording at 0, 1, 30 and 31 days; the path for a play just after
  local midnight; the reset keeps Library filters and survives the view's load;
  the line keeps its plays after the row is re-read.
- Story: `PlayerBar` with a played and a never-played song.
