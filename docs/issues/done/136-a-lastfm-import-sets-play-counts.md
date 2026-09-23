# 136 — A last.fm import sets the play counts of the songs it matched

An import wrote `plays` rows and never touched `tracks.play_count`, which only
`playback::mark_played` moved. A song heard 300 times before this app read 0 in
the Plays column and to smart playlists.

`Import::run` now ends with `count`, after `plays::resolve` and in its
transaction: each linked track's `play_count` and `last_played_at` are raised to
the count and newest `started_at` of its linked plays.

- **`max`, not add or replace.** Add would count twice every play from before
  migration 13 that was also scrobbled; replace would lower a count holding
  those. A local play since is one row and one count, and the import skips its
  scrobble's second. Idempotent, so a re-import moves nothing.
- **Guarded**, so a row whose values already hold is not written:
  `tracks_fts_update` reindexes on any update of `tracks`.
- **Import only**, not wherever `resolve` runs: a retag that moves a key would
  give the new file the count while the old one kept its own.
- **Only the copy `resolve` links a key to is raised** (present before
  missing, then the lowest id). `resolve` relinks local plays too, so that copy
  also absorbs the local plays of the song's other copies.

Stacks on 135: the counts are only as good as the links.

## Verification

- After an import, a song with last.fm history shows that history in Plays.
- Importing again leaves every count as it was.
- A song whose local count is higher than its log keeps its local count.
- With an album copy and a compilation copy of one song, only the one that
  `resolve` links gets the count.
