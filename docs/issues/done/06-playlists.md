# 6 — Playlists: CRUD, drag and drop, reorder

Merged in `8f10a3d`.

- **A playlist is a filter on the same query, not a query of its own.**
  `TrackQuery` gained `playlist_id`, which joins `playlist_tracks`, so paging,
  search-within, sorting, select-all and the play queue work inside a playlist
  with no second code path. `Position` became a `SortField` the same way
  relevance did.
- Positions are gapped by 1024; an exhausted gap renumbers the whole playlist
  once, with a gap wide enough that the retry cannot fail the same way.
- A playlist holds each track at most once, by schema.
- Reordering is offered only in the playlist's own order.
- Drag payloads travel under a private MIME type.

**This phase shipped unusable and nobody could tell.** Tauri's `dragDropEnabled`
defaults to *true*, and while it is on the webview hands OS drag events to the
native file-drop handler instead of the page — killing HTML5 drag and drop inside
the window. Everything built here was correct and unreachable until phase 15's
decision set the flag to `false`. CI could not catch it: WebDriver cannot perform
an OS drag.
