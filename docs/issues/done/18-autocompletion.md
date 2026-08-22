# 18 — Tag and filter autocompletion

Merged in #39.

**Migration 5** adds `tag_values(field, value)` with a case-insensitive lookup
index: the distinct values a library already uses, maintained as tracks are
ingested and edited, so completion is a keyed read rather than a `DISTINCT` over
the whole library on every keystroke.

Feeds both the tag editor's fields and the smart-playlist rule builder's value
input — the same vocabulary in both places, which is the point.
