# 136 — A last.fm import sets the play counts of the songs it matched

An import writes `plays` rows and never touches `tracks.play_count`, which
only `playback::mark_played` moves
([playback.rs:94](../../../src-tauri/src/db/playback.rs#L94)). A song heard 300
times before this app still reads 0 in the Plays column and to smart playlists.

At the end of `Import::run`, after `plays::resolve` and in its transaction
([import.rs:155](../../../src-tauri/src/lastfm/import.rs#L155)):

```sql
UPDATE tracks
   SET play_count = n.plays
  FROM (SELECT track_id, count(*) AS plays FROM plays
         WHERE track_id IS NOT NULL GROUP BY track_id) n
 WHERE n.track_id = tracks.id AND n.plays > tracks.play_count
```

The guard matters: `tracks_fts_update` fires on any update of `tracks`
([schema.rs:557](../../../src-tauri/src/db/schema.rs#L557)), so an unguarded
write reindexes every linked track on every import.

## What the terms mean

- **Exact match** is `plays::match_key` equality — artist and title, with the
  fold from [120](../done/120-match-key-folds-punctuation.md). Album stays out:
  a scrobble carries the streaming service's album spelling, and the
  compilation copy would never match.
- **First of several** is the file `resolve` already links the key to: present
  before missing, then the lowest id
  ([plays.rs:424](../../../src-tauri/src/db/plays.rs#L424)). The other copies
  are left alone. Nothing new to decide.

Stacks on 135: the counts are only as good as the links, and 135 links
thousands more plays.

## Decisions

- **`max`, not replace or add** (recommended). All linked plays count, local and
  imported. That is safe because the import already skips a second holding a
  local play ([import.rs:340](../../../src-tauri/src/lastfm/import.rs#L340)),
  and a local play adds one to `play_count` and one row. Add would count twice
  every play from before migration 13 that was also scrobbled. Replace would
  lower a count holding those plays. `max` is idempotent: re-importing, or
  re-importing from scratch, never moves a count twice or lowers one.
- **`last_played_at` too?** Recommend yes, `max` with the newest linked
  `started_at`, in the same statement.
- **Import only, or wherever `resolve` runs?** Recommend import only. At scan
  end it would also cover files added after an import, but a retag that moves a
  key would give the new file the count while the old file kept its own.

`invalidate::announce` already runs after an import
([commands/mod.rs:1600](../../../src-tauri/src/commands/mod.rs#L1600)), so the
table refreshes.

Tests go in `import.rs`: a count raised, a higher local count kept, a second
run changes nothing, and only the first of two copies is raised. Add one line
to "The play log" in `docs/knowledge/data-model.md`.

## Verification

- After an import, a song with last.fm history shows that history in Plays.
- Importing again leaves every count as it was.
- A song whose local count is higher than its log keeps its local count.
- With an album copy and a compilation copy of one song, only the one that
  `resolve` links gets the count.
