# 144 — Reset All Columns

The column header menu offers "Reset All Columns" under "Reset Columns".

- `reset_all_column_configs` → `playlists::forget_all_columns`: in one
  transaction, `columns_json = NULL` on every playlist and the
  `library.columns` setting deleted.
- `resetAllColumns` shows the defaults in the current view without saving them,
  so that view inherits like every other. A failure is reported and the layout
  on screen is left alone.

## Verification

- Customise the library and two playlists, pick Reset All Columns in one of
  them: all three show the defaults, including after a restart.
- Afterwards, changing the library's columns changes both playlists too.
