# 188 — The palette remembers

Needs 185. With the field empty, the last 8 commands run lead, as Recent.

## Shape

- An entry is keyed by its `MenuItem.id`, else by group and label: the Edit
  menu's Play and the transport's share a label. An entry whose label follows
  state carries an id — counts and names (`Remove 3 Songs…`, `Export “Mix”…`,
  `Add to Playlist › Mix`, `Back to …`) and toggles (Play/Pause, Mute, Repeat,
  Love).
- Recents are keys, re-resolved against the current commands on open. One that
  is not offered now (a deleted playlist, the open view) is not listed; one
  that is greyed shows greyed. An entry under Recent is left out of its own
  group.
- Commands and Go to only. Found music (187) is not remembered.
- Stored as `palette.recents`. Not exportable: it names playlist ids.

## Tests

- Most recent first, deduplicated, capped at 8.
- A vanished key drops; a greyed one stays greyed.
- A toggle keeps its id across its label change.

## Verification

- Run three commands, reopen: they head the list, newest first. After a
  restart, still there.
- Delete a playlist that was recent: gone from Recent.
