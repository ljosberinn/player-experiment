# 69 — Albums is Releases

The Library section's second item is called Albums. A release is what it holds:
an EP, a single, a split and a compilation are all in there, and none of them is
an album.

**Label only.** `BrowseKind` is the IPC wire type and `"albums"` reaches the
browse query, the navigation history and the remembered scroll offset. Renaming
the identifier churns all of that for a word nobody reads.

Changes: the sidebar item, the view heading, `viewSummary`'s noun ("12
releases"), the history arrows' titles, and `unknownLabel("albums")` to Unknown
Release.

Does **not** change: the Album column, the Album smart-playlist field, or
`tracks.album`. Those name the ID3 frame, which is still called that.

Six e2e specs select the sidebar item by its literal text — `browse-layout`,
`browse-scroll`, `library`, `navigation-history`, `smoke` — and
`navigation-history` asserts the title "Forward to Albums".
