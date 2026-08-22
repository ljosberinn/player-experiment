# 5 — Search: debounce and relevance ranking

Merged in `843cbcf`.

FTS5 over title/artist/album/album_artist/genre/comment, debounced from the
toolbar.

- **Relevance is a `SortField`, not a flag.** `bm25` is weighted so a title hit
  outranks a comment hit, and it ignores sort direction. With no search it falls
  back to a real column.
- Searching switches the view to relevance and restores the previous column sort
  when the box is cleared — unless the user picked a column while searching,
  which is treated as an explicit override.
- **Every query carries a token**, checked before a response writes. A slow first
  search can no longer overwrite a later one — a race the paged loader had from
  phase 3 and debouncing only made likelier.
