# 169 — A removed copy hands its plays to the copy that stays

*Tonight's Special Death* (King Dude) is in the library twice, in one folder,
same release MBID: ids 34315–34324 at ~140 kbps, 70831–70840 at 320 kbps
(the second rip). Each pair shares a `match_key`, so `resolve` links every play
to the lower id. The old copy reads 185 plays across the album, the 320 copy 0.

Removing the old copy today:

- **The log survives.** `ON DELETE SET NULL`, then `resolve` relinks to the
  copy that is left. Statistics are unchanged.
- **`play_count` and `last_played_at` go with the row.** The 320 copy reads 0
  in Plays, Most Played and smart playlists until the next last.fm import's
  `count` raises it. Without an import, and for plays from before migration 13,
  they are gone.
- **Playlist entries go too** (`ON DELETE CASCADE`). None here.

The same holds for deleting the files on disk and then Remove Missing Songs.

## Fix

In `scan::remove_tracks` and `scan::remove_missing`, in one transaction with
`resolve`:
for each removed row whose `match_key` is on a track that stays, the survivor
is the one `resolve` would link to, present first, then the lower id.

- The survivor's `play_count` becomes `max(survivor, removed, linked plays after
  resolve)`, and its `last_played_at` the max of the three. **`max`, never add**,
  as in 136. After an import the survivor's count already includes the other
  copy's plays.
- The removed row's playlist entries move to the survivor at the same position.
  Where the survivor is already in that playlist, the entry is dropped.
- When a removal takes every copy of a key, nothing carries over. The plays stay
  in the log, unlinked.

Only `tracks.match_key` counts, the artist key. The album-artist and album tiers
of `resolve` are left out. Removing a compilation copy hands its count to the
album copy, which is where the log already links it.

Both confirmations (`App.tsx`, Remove Missing Songs and `pendingRemoval`) add:
"Plays and playlist places move to another copy of the same song, where there
is one."

## Rejected

- **Mirroring counts across every copy of a key.** The album and compilation
  copies would both show the count, and Most Played would list the song twice.
  136 gives the count to one copy on purpose.
- **A manual "merge into" action.** More UI for the same result. The removal is
  when the plays are lost.

## Out of scope

- While both copies exist, a local play of the 320 copy raises that copy's
  count, but its log row links to the old copy. This fixes itself once the old
  copy is removed.
- 25 plays of `My Everlasting Life` stay unlinked. The file's title is
  `My Everlasting Life II`, so this is a tag problem.

## Tests

In `scan/mod.rs`:

- Removing the played copy of a pair: the survivor takes its count, last played
  and playlist entries.
- The survivor already has a higher count: it keeps it.
- Both copies are removed in one call: nothing is written, and the plays stay
  unlinked.
- A missing copy removed through `remove_missing` carries its count to the
  copy that is present.
- A removed row whose key no other track carries: behaves as before.

## Verification

- Remove one copy of a played song that has a second copy. The copy that stays
  shows its plays and last played and takes its playlist places, and
  Statistics are unchanged.
- Delete that copy's file, rescan, Remove Missing Songs: the same.
- Both confirmations show the new sentence.
