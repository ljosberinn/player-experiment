# 130 — The default columns are #, Title, Duration, Artist, Album, Genre, Year, Bit Rate

Default order after the status column:
`trackNo, title, durationMs, artist, album, genre, year, bitrate`
([columns.ts](../../../src/features/library/columns.ts), `DEFAULT_COLUMN_IDS`).
Every column stays hideable.

## Renames

`title` reads **Title** (was Name), `durationMs` reads **Duration** (was Time)
in `ALL_COLUMNS`, the smart playlist sort and filter lists
([filterTree.ts](../../../src/features/smart/filterTree.ts); the filter reads
"Duration (ms)") and the tag editor's field labels
([fields.ts](../../../src/features/editor/fields.ts)).

## Bit Rate is a new column

- `SortField::Bitrate` → `"bitrate"` in
  [model.rs](../../../src-tauri/src/model.rs) and `as_sql`. `sort_order_by` and
  `smart_order_by` need nothing; nulls sort last already.
- `ALL_COLUMNS` entry: "Bit Rate", right-aligned, `${bitrate} kbps` as the
  gutter prints it, empty for null.
- `SORT_FIELDS` for smart playlists offers Bit Rate.

## Stored layouts

`serializeColumnConfig` writes `version: 1`. `parseColumnConfig` gives a stored
layout without it `trackNo` first and `year` and `bitrate` appended, each only
where missing; the rest of its order is kept. The next save writes the version,
so a layout that hid one of them on purpose gets it back once.

## Tests

E2E row readers address cells by `data-column` rather than position, since
Title is no longer the first cell after status.

## Verification

- Fresh install: Songs reads status, #, Title, Duration, Artist, Album, Genre,
  Year, Bit Rate.
- Existing library and playlist layouts gain the missing three once, keeping
  their order otherwise; hiding one afterwards sticks across restarts.
- Bit Rate sorts, nulls last in both directions; a 320 file reads "320 kbps".
- Reset Columns restores the new default set.
