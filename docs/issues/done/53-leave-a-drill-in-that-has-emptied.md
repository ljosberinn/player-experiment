# 53 — Leave a drill-in whose group no longer exists

A drill-in landing with zero rows now ejects to its group list, from
`store.ts`'s `refresh()` itself so a tag edit, a missing file and a rescan are
all covered by the one check rather than the editor's path alone.

Eject only when, once the query has landed: `browse !== null`, `search` is
blank, and `total === 0`. A search matching nothing inside a live group is a
real answer, not the group's disappearance, so it is excluded by the blank-
search condition; a refresh still in flight never reaches the check at all,
since it runs after both the count and the group list have resolved and is
itself guarded by the query token.

The dead entry is dropped from history with `forgetGroup` (`history.ts`),
built the way `forgetPlaylist` drops a deleted playlist's — not `pushEntry`,
which would leave Back pointing straight at the group that is gone.

Whether `ROME` and `Rome` should have been one group (`NOCASE` grouping)
stays open — it changes what every browse view shows, and is out of scope
here.
