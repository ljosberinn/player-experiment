# 183 — A scan or a retag sets play counts

A file added or retagged after a last.fm import had its plays linked by
`plays::resolve` but kept `play_count` 0 and no `last_played_at`: only the
import raised them (136).

## Fix

`count` moves from `lastfm::import` to `plays::count` and runs after `resolve`
at the end of a scan and in a tag write's transaction.

Reverses 136's "import only": a mistag that moves a key leaves its count on the
file, since counts are never lowered.

## Verification

- Import, then add a file of a song in the log: its Plays and Last Played show
  the history after the scan.
- Retag a file into a song in the log: the same after the write.
- Rescanning an unchanged library writes no `tracks` row.
