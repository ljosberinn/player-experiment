# 180 — The row menu goes to the last play

After [179](179-the-player-bar-says-when-you-last-heard-it.md).

A row-menu entry *Show Last Play*, hinted with 179's `lastPlayedWords`
(`3 days ago`), that opens `showLastPlay(last_played_at)`. After *Show in
Explorer*, and in the Edit menu through `rowMenuItems`.

- Absent when the row has never been played, or when there is no row to name —
  the Edit menu with several selected, like the lookups. Right-click with
  several selected greys it, without the hint: on a greyed entry a hint reads
  as the reason.
- `LinkableTrack` gains `last_played_at`.
- **A counted play announces `library://changed`.** It did not, so the table's
  row kept the play before and the entry pointed at it; the Plays and Last
  Played columns and smart playlists were stale the same way.

## Verification

- A played row lands on Statistics › Listening › that day, with the song in
  its recent plays, whatever filters were stored.
- Right after a song counts, its row says `today`.
