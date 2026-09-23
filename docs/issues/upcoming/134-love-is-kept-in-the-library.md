# 134 — Love is kept in the library, with or without last.fm

Love works on every build, with no key and no account. The loved set becomes
local state in the library database. A connected account mirrors it: a love or
unlove here is sent to last.fm, and last.fm's loved tracks come back in.

Supersedes [102](../done/102-love-a-track-from-the-app.md)'s gating ("absent
with no key", "greyed with no account"), its "no queue" rule and its rollback.

## Today

- `lastfm_loved(match_key)` is written by `Import::loved`, which replaces it
  wholesale at the tail of a full history import
  ([import.rs:160-165](../../../src-tauri/src/lastfm/import.rs#L160-L165),
  [:241-277](../../../src-tauri/src/lastfm/import.rs#L241-L277)), and by
  `love::set`, which writes first and rolls back on a failed call
  ([love.rs:48-72](../../../src-tauri/src/lastfm/love.rs#L48-L72)).
- `lastfm_love` refuses without key or session (`lastfm_ready`,
  `stored_session`) ([commands/mod.rs:1634-1663](../../../src-tauri/src/commands/mod.rs#L1634-L1663)).
- Love calls bypass `scrobble_queue`; nothing retries them.
- Membership resolves only through `plays.track_id`
  ([loved.rs:25-27](../../../src-tauri/src/db/loved.rs#L25-L27)). **A song
  never played has no bridge**: loving it stores the key, but `loved::tracks`
  does not return it, so the menu keeps saying Love. Rare with an imported
  history, the common case without one.
- The window holds the set in `useLastfmStore.loved`
  ([store.ts:57](../../../src/features/lastfm/store.ts#L57)). `lovingFor`
  answers `undefined` without a key
  ([rowMenu.ts:68](../../../src/features/library/rowMenu.ts#L68)); `loveItem`
  greys without an account
  ([rowMenu.ts:233](../../../src/features/library/rowMenu.ts#L233)).
- The smart-playlist editor disables Loved without key or account
  (`useLovedUnavailable`,
  [SmartPlaylistEditor.tsx:58-68](../../../src/features/smart/SmartPlaylistEditor.tsx#L58-L68)).
  The Statistics Loved filter reads `plays.match_key` and needs only the table
  rename below ([stats.rs:102](../../../src-tauri/src/db/stats.rs#L102)).

## Storage — migration 18

- `ALTER TABLE lastfm_loved RENAME TO loved`. Existing rows stay and become
  local loves, including keys with no library track (they surface when the
  song is added).
- `tracks.match_key TEXT`, indexed, written wherever artist or title is
  ([scan/mod.rs:656](../../../src-tauri/src/scan/mod.rs#L656),
  [:706](../../../src-tauri/src/scan/mod.rs#L706),
  [tags/write.rs:629](../../../src-tauri/src/tags/write.rs#L629)) and by
  `plays::refold`. Backfilled in Rust behind a settings marker, the way
  `refold_if_stale` runs: `match_key` is not expressible in SQL.
- `loved::MEMBERS` becomes `SELECT id FROM tracks WHERE match_key IN (SELECT
  match_key FROM loved)`. This reverses 101's "no link, no migration": its
  measurement assumed every loved song had a play.
- `love_queue(match_key PRIMARY KEY, artist, title, loved, attempts,
  next_try_at)`: the latest intent per song, pending for last.fm.

## Toggle

- New command `set_loved(track_ids, loved)` (replaces `lastfm_love`): writes
  `loved`, never rolls back, answers the set. Needs no key.
- With a connected account it also enqueues each song in `love_queue` and
  sends a `Flush`. `Service::flush`
  ([lastfm/mod.rs:354](../../../src-tauri/src/lastfm/mod.rs#L354)) drains it
  alongside scrobbles: `track.love` / `track.unlove` per row, same backoff,
  code 9 disconnects as today. With no account, nothing is queued.
- A push failure is not reported per toggle; the love already stands here. A
  backlog shows in the queue-depth line.
- `loved` and `love` move out of `useLastfmStore` into a store of their own;
  `useLoveEntry` and `App`'s startup read it.
- `lovingFor` loses `configured` and `connected`. Love is present whenever
  something is selected; the only grey is `No artist and title`.
- `useLovedUnavailable` goes; Loved is always offered in the editor.

## Sync

A refresh is `Import::loved` on its own: on connect, at launch while connected,
and at the tail of an import.

**Decide: conflict direction.**

- **A. last.fm wins, undelivered local changes win over it** (recommended). A
  refresh for the connected account drains `love_queue` first, then sets
  `loved` to last.fm's set, except keys still queued, which keep their queued
  state. Unloves made on the website or a phone arrive.
- **B. Union.** A refresh only adds. Unloves made elsewhere never reach here.

Either way, an import for a username that is not the connected account (or
with no account) only adds loves; it never removes local ones.

**Decide: loves made before connecting.** Recommended: the first refresh after
connecting an account adds last.fm's set to local, then queues a `track.love`
for each local key last.fm lacks that resolves to a track, then syncs as
above. Marker: settings `loved.syncedWith = <username>`. Alternative: they stay
local only, in 10d's opt-in reading.

**Decide: export.** `loved` is now user data held only here. Recommended: the
library export carries it; note the addition in `export-schema.md`.

## Tests

- Flip: `rowMenu.test.ts` "offers nothing on a build with no key"
  ([rowMenu.test.ts:351](../../../src/features/library/rowMenu.test.ts#L351));
  the keyless case
  ([SongTable.test.tsx:617](../../../src/features/library/SongTable.test.tsx#L617))
  now offers Love; the no-account grey goes.
- `lastfm/store.test.ts` loved-set block (L346 on) moves with the store; the
  rollback cases become "stays loved on a push failure".
- `SmartPlaylistEditor.test.tsx`: Loved enabled with no key.
- `love.rs` rollback tests become queue tests; `import.rs` loved tests assert
  the chosen direction; `loved.rs` gains a never-played track in the set.
- e2e: [row-menu.test.ts:242](../../../e2e/specs/row-menu.test.ts#L242)
  asserted absence on the keyless CI build. Replace it with a spec that loves a
  song, reopens the menu to find Unlove, and unloves it.

## Docs

`data-model.md` (migration table, the `lastfm_loved` bullets at L428-440, the
editor bullets at L514-520), `architecture.md` L80-88, `frontend.md` L746,
`export-schema.md` if export carries it.

## Verification

- Keyless build: Love and Unlove from the row menu and the Edit menu, on a
  never-played song too. The state survives a restart.
- Loved smart playlist and the Statistics Loved filter follow a local love.
- Connected: a love here appears on last.fm; offline, it goes out on the next
  flush.
- Connected: a love or unlove made on last.fm shows here after a relaunch
  (under A).
- An upgraded library keeps every song it loved before.
