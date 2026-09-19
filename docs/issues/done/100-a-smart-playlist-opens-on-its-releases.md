# 100 — A smart playlist opens on its releases

A smart playlist is a question about the library, and the answer reads better
as releases than as a flat list of tracks. Selecting one landed on Songs,
because `showPlaylist` carried whichever tab was open into the new source.

Nothing else was in the way: `browse_groups` runs through the same `scope()`
the songs table does, so the grid, the per-tile counts and the drill-in were
already correct inside a smart playlist — it was only never the landing state.

## What shipped

- `showPlaylist` takes the `Playlist` row rather than an id, because the
  landing tab depends on the kind and the library store has no business
  reading the playlists store. `playPlaylist` was widened the same way; its
  one caller has the row.
- `landingTab`: a smart playlist lands on `"albums"` whatever was open. A
  static playlist is an ordered list somebody built by hand, so it keeps the
  carry-over, and so does the library. Statistics still falls back, now to the
  kind's landing tab rather than always to Songs.

`sortForEntry` needed nothing: landing on Releases with no drill-in gives
`sortBy: "position"`, which the grid does not read — `browse_groups` has its
own `ORDER BY` — and which is safe in SQL, `SortField::Position` falling back
to `added_at` outside a static playlist.

## The `showTab` half was cut

The issue also proposed that `showTab` keep `playlistId`, so a LIBRARY button
would say *how* to look at the current source rather than *what* the source is.
It was cut during implementation.

The drill-in already covers the case that motivated it: `openGroup` and
`closeGroup` both carry `playlistId`, so tiles → a release's tracks → back to
the tiles all stay inside the playlist without any change to `showTab`.

What the cut costs is the flat track list of a smart playlist spanning several
releases: there is no screen listing it, only one release at a time. What it
buys is that LIBRARY keeps its second job. Those rows double as *back to the
whole library*, and they are the only control that does — the section header is
an `<h2>`, and clicking the open playlist is a deliberate no-op. Taking that
job away needs a source row the sidebar does not have (an "All Songs" above
Songs), and adding one was more than this phase was for.

So the rule at `App.tsx` and `LibraryNav.tsx` still holds and still reads the
way it did: one highlighted row, one answer to one question. Anything that
wants the flat list back has to introduce that source row first.

## Testing

`store.test.ts`: a smart playlist opens on Releases and a static one on Songs,
each from both Songs and Releases so it is the kind deciding and not the
carry-over; and both from Statistics.

`App.test.tsx`: clicking a smart playlist renders the release grid and
`browseGroups` is called with that `playlistId` — the assertion that the grid is
scoped. The reordering-and-removal case now reaches its rows through a
drill-in, which is the only route to them.

`e2e/specs/smart-playlists.test.ts` is pinned to one artist and a cutoff of
one. Its point is that a cutoff is membership rather than display — sorting the
view must not change which songs are in it — and that comparison needs a single
screen listing everything the playlist holds. Behind a drill-in, that means the
playlist has to fit in one release.
