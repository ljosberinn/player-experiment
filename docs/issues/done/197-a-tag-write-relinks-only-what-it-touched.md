# 197 — A tag write relinks only what it touched

A tag write ran the full `plays::resolve` (~1.0s on the real library) and
`plays::count` inside its transaction, whatever it wrote.

- `tags::write::apply` reads each file's `plays::link_tags` (artist, title,
  album, album artist) before `sync_row` and runs `plays::relink` instead:
  `resolve` and `count` over a scope. A write that changed none of the four
  relinks nothing.
- Scope (`plays::scope`): plays under the old and new artist and album-artist
  keys; every play on the old and new folded albums, and on the albums of the
  plays under those keys (a play that gains or loses a key leaves or joins its
  album group); tracks on those albums, and tracks whose artist or album
  artist folds to the artist side of any scoped play's key. A blank album
  scopes nothing.
- Albums and artists are matched by folding every distinct spelling in
  `plays` and `tracks`, since only the artist key is stored: one read of the
  log, over `idx_plays_album`.
- `relink` matches a full pass only over a resolved log, so it leaves
  `plays.resolved` as it found it.
- Migration 22: `idx_plays_key`, `idx_plays_album`. One file retagged is
  ~0.1s.
- Scans and removals still run the full `resolve`.
- `docs/knowledge/data-model.md`.

## Tests

In `plays.rs`: a retag that gives a play its key unlinks the group it leaves;
`relink` leaves `plays.resolved` as it found it; 300 seeded random retags,
each followed by a full `resolve` and `count` that change nothing.

In `tests/perf.rs`: relinking one retag reads the log once.
