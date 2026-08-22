# Import a library export

Export is a one-way door. The [schema](../../knowledge/export-schema.md) is
documented well enough to read, but nothing reads it back.

The obvious use is restoring play counts, `last_played_at` and playlists onto a
rebuilt library — which is also what makes it worth having, since the identifier
rename orphans a database and a rescan re-adds every file as a new row with a new
id.

Shape questions to settle first:

- **Match on `path`**, presumably, since ids cannot survive a rebuild. What
  happens to rows the export names and the library does not have?
- **Merge or replace** for play counts. Adding is wrong if the same export is
  imported twice; replacing loses plays accrued since.
- A smart playlist imports as its filter, a static one as a path list. A static
  playlist whose tracks are partly missing should report what it could not place
  rather than silently shrinking.
- Nothing should be written unreviewed — the same confirm-dialog principle the
  tag lookup follows.
