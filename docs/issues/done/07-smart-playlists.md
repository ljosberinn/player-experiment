# 7 — Smart playlists: filter compiler and editor

Merged in `c067f57`.

A persisted filter tree compiled to a parameterized `WHERE` clause by
`smart/compile.rs`, plus the rule-builder dialog.

- **The filter is stored as a tree, never as SQL** — the editor has to read it
  back, and a stored SQL string would be both unparseable for the UI and an
  injection surface.
- `FilterValue` is typed; a mismatch is refused at save time, not coerced.
- Exclusion operators spell out the NULL case; `LIKE` patterns escape `%`, `_`
  and the escape character; depth and rule count are capped at 10 and 200.
- An empty filter matches everything. `now` is passed in, so "added in the last
  7 days" is testable.
- A smart playlist's count is its query's count, through the same `count_tracks`
  the view uses, so the sidebar and the table cannot disagree.
- A deleted playlist reads as an empty view, not an error. The editor stays open
  when the backend refuses a filter.
