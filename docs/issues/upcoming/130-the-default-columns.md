# 130 — The default columns are #, Title, Duration, Artist, Album, Genre, Year, Bit Rate

Default order after the status column:
`trackNo, title, durationMs, artist, album, genre, year, bitrate`
([columns.ts:47](../../../src/features/library/columns.ts#L47)). Every column
stays hideable.

## Renames

`title` reads **Title** (was Name), `durationMs` reads **Duration** (was Time)
([columns.ts:17](../../../src/features/library/columns.ts#L17)). The smart
playlist sort list ([filterTree.ts](../../../src/features/smart/filterTree.ts))
and the tag editor's field labels
([fields.ts](../../../src/features/editor/fields.ts)) follow if they print the
same words.

## Bit Rate is a new column

No `bitrate` `SortField` exists, and column ids are `SortField`s.

- `SortField::Bitrate` → `"bitrate"` in
  [model.rs:73](../../../src-tauri/src/model.rs#L73) and `as_sql`
  ([:108](../../../src-tauri/src/model.rs#L108)). `sort_order_by` needs nothing
  ([query.rs:412](../../../src-tauri/src/db/query.rs#L412)); nulls sort last
  already. Regenerate `SortField.ts`.
- `ALL_COLUMNS` entry: "Bit Rate", right-aligned, `${bitrate} kbps` as the
  gutter prints it ([browse.ts:115](../../../src/features/library/browse.ts#L115)),
  empty for null.
- `SORT_FIELDS` for smart playlists
  ([filterTree.ts:313](../../../src/features/smart/filterTree.ts#L313)) is an
  explicit list; add Bit Rate there too.

## Stored layouts

[columns.ts:47](../../../src/features/library/columns.ts#L47) covers only an
absent config. A stored one lists its ids with no version
([parseColumnConfig](../../../src/features/library/columns.ts#L171)). Add one.
A config without it gets `trackNo` inserted first and `year` and `bitrate`
appended, each only where missing; the rest of its order is kept. The next save
writes the version. A layout that hid one of them on purpose gets it back once.

## Tests

Header-label assertions move with the renames: `SongTable`, `ReleaseGroups`,
`App`, `columnFit`, `SmartPlaylistEditor`, `TagEditor` tests.

## Verification

- Fresh install: Songs reads status, #, Title, Duration, Artist, Album, Genre,
  Year, Bit Rate.
- Existing library and playlist layouts gain the missing three once, keeping
  their order otherwise; hiding one afterwards sticks across restarts.
- Bit Rate sorts, nulls last in both directions; a 320 file reads "320 kbps".
- Reset Columns restores the new default set.
