# 2 — Library core: schema, scan, queries

Merged in #2.

Migrations 1 and 2, the `walkdir` + `rayon` scanner (incremental by mtime and
size), the paged query, and `scan://progress`.

- Covers are deduped by content hash and served over a `cover://<hash>` protocol
  handler — bytes never travel in a row payload.
- `dialog:allow-open` was added here for the watch-folder picker. Nothing made
  the absence of its sibling `allow-save` visible until phase 9 shipped broken.
