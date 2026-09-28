# 149 — The import total climbs by one each page

During a last.fm import the total in "n of n scrobbles" rises by one with every
page. Investigate.

Lead: `next_cursor` asks for `to = oldest + 1`, so each page re-fetches the
previous page's boundary second. That scrobble is counted again in last.fm's
`total` and in `seen` (`Import::history` in `src-tauri/src/lastfm/import.rs`),
while the identity index drops it from `imported`.

## Verification

- An import's total holds steady from the first page to the last.
- A from-scratch import's final `done` matches the scrobble count on the last.fm profile.
