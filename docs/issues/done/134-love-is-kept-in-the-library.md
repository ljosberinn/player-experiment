# 134 — Love is kept in the library, with or without last.fm

Love works on every build, with no key and no account. The loved set is local
state in the library database. A connected account mirrors it: a love or unlove
here is queued for last.fm, and last.fm's loved tracks come back in.

Supersedes [102](102-love-a-track-from-the-app.md)'s gating, its "no queue"
rule and its rollback.

## Storage — migration 18

- `lastfm_loved` → `loved`, plus `remote` (last.fm reported the key). Existing
  rows are set: they came from an import or were sent by 102.
- `tracks.match_key`, indexed, written by the scan, `tags::write::sync_row` and
  `plays::refold`. `MATCH_FOLD_VERSION` 2 backfills it; the fold thread emits
  `loved://changed` when a track key moved.
- `loved::MEMBERS` resolves through `tracks.match_key`, so a song never played
  is lovable.
- `love_queue(match_key PK, artist, title, loved, attempts, next_try_at)`: the
  latest intent per song.
- `loved.syncedWith` seeded from the import state's username.

## Toggle

- `set_loved(track_ids, loved)` replaces `lastfm_love`; `loved_tracks` replaces
  `lastfm_loved_tracks`. Writes `loved`, never rolls back, needs no key.
- Connected: each song is queued and the scrobbler flushed. `Service::flush`
  drains `love_queue` after the scrobbles, with the scrobble backoff and
  attempt cap, no age limit. Code 9 disconnects; other permanent errors drop
  the row.
- A backlog shows as its own line in Settings (`lastfm://loves-queued`).
- `useLovedStore` holds the set. Love is offered whenever something is
  selected; the only grey is `No artist and title`. Loved is always offered in
  the smart-playlist editor.
- The scrobbler is app state, cloned onto the player thread.

## Sync

A sync is `Import::loved`: at launch while connected and on connecting (the
scrobbler's `RefreshLoved`, flushing first), and at the tail of an import.

- **Three-way.** For the connected account, reported keys become `remote`; a
  `remote` key no longer reported is removed; queued keys are left alone. last.fm
  autocorrects artist and title ([import.rs](../../../src-tauri/src/lastfm/import.rs),
  `insert`), so a love made here can come back under another key; it is never
  taken for an unlove. Known gap: unloving on the website a song loved here
  under a corrected spelling leaves it loved locally.
- **First sync with an account** (`loved.syncedWith` differs): every key becomes
  local, each one last.fm lacks that a track carries is queued as a love, and
  the marker is set.
- **Any other username, or no account:** an import only adds.

## Export

`tracks[].loved`; noted in `export-schema.md`.

## Verification

- Keyless build: Love and Unlove from the row menu and the Edit menu, on a
  never-played song too. The state survives a restart.
- Loved smart playlist and the Statistics Loved filter follow a local love.
- Connected: a love here appears on last.fm; offline, it goes out on the next
  flush.
- Connected: a love or unlove made on last.fm shows here after a relaunch.
- An upgraded library keeps every song it loved before, including after the
  first launch's backfill.
