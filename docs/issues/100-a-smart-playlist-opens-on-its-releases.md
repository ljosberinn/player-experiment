# 100 — A smart playlist opens on its releases

A smart playlist is a question about the library, and the answer reads better
as releases than as a flat list of tracks. Selecting one lands on Songs today,
because `showPlaylist` carries whichever tab was open into the new source:

```ts
// store.ts:620
const tab = get().tab === "stats" ? "songs" : get().tab;
```

Nothing else is in the way. `browse_groups` runs through the same `scope()`
the songs table does ([query.rs:459-474](src-tauri/src/db/query.rs#L459-L474)),
which compiles the smart filter and applies a `SmartOrder` limit, so the grid,
the per-tile track counts and the drill-in are already correct inside a smart
playlist — it is only never the landing state. Switch to Releases first and
then click the playlist and you get the view this issue is asking for.

## The tab comes from the playlist's kind

`showPlaylist` ([store.ts:610-622](src/features/library/store.ts#L610-L622))
takes `playlistId: number | null` and nothing else. It needs the kind. Widen
the signature rather than reaching into the playlists store from the library
store: [PlaylistSidebar.tsx:190](src/features/playlists/PlaylistSidebar.tsx#L190)
already has the whole `Playlist` row, and the three other callers
([playlists/store.ts:242, :274, :344](src/features/playlists/store.ts#L242))
know what they opened.

Smart lands on `"albums"`. A static playlist is an ordered list somebody built
by hand, so it keeps today's behaviour, and the library does too.

This is `Changing source resets the view` ([conventions](../knowledge/conventions.md))
doing what it already does; the only change is what it resets to.

`sortForEntry` needs nothing: landing on Releases with no drill-in gives
`sortBy: "position"`, which the grid does not read — `browse_groups` has its
own `ORDER BY` — and which is safe in SQL, `SortField::Position` falling back
to `added_at` outside a static playlist.

## Songs has to stay in the playlist

`showTab` sets `playlistId: null` ([store.ts:704](src/features/library/store.ts#L704)),
so the LIBRARY buttons switch *source* as well as grouping. That is survivable
while every playlist opens on Songs. It is not survivable once one opens on
Releases: the flat track list of a smart playlist would be reachable only by
drilling into a release, and the obvious control for it would silently throw
the playlist away.

`showTab` keeps `playlistId`. **This reverses a decision that is argued in two
places** — the comment at [App.tsx:326-328](src/App.tsx#L326-L328) ("two
highlighted rows would be two answers to one question") and the module comment
at [LibraryNav.tsx:9-13](src/components/ui/LibraryNav.tsx#L9-L13) — and the
argument was sound for what the sidebar did then. It does something
else now: a LIBRARY button says how to look at the current source, and the
PLAYLISTS entry says what the source is. Two controls, two questions.

Consequences:

- `active={playlistId === null ? tab : null}` ([App.tsx:329](src/App.tsx#L329))
  becomes `active={tab}`, so the open tab and the open playlist are both
  highlighted. That is the state the app is actually in.
- **Statistics is the exception.** It is not a grouping a playlist can be shown
  in — `showPlaylist` already refuses to carry it — so `showTab("stats")` still
  clears `playlistId`. The one place the button still changes source, and it
  needs the comment saying why.
- The no-op guard at [store.ts:694](src/features/library/store.ts#L694) loses
  its `&& playlistId === null`: clicking the open tab is now a no-op inside a
  playlist too, because there is no longer a playlist for it to drop.

Nothing persists a view, so there is no stored state to migrate, and the
history entries are in memory.

## Testing

Unit, in `store.test.ts`:

- a smart playlist opens on Releases; a static one opens on Songs; both from
  Songs and from Releases, so it is the kind deciding and not the carry-over;
- opening a smart playlist from Statistics lands on Releases, not Songs;
- `showTab("songs")` inside a playlist keeps `playlistId`, and `showTab("stats")`
  clears it;
- clicking the open tab inside a playlist is a no-op.

The existing `showPlaylist` cases and the several that assert `tab: "songs"`
after `showPlaylist(5)` need the mocked playlist's kind checked against what
they mean to assert.

In `App.test.tsx`, clicking a smart playlist renders the release grid and
`browseGroups` is called with that `playlistId` — the assertion that the grid
is scoped, which is the half of this that already works and should stay
working.

e2e is worth one spec: a seeded smart playlist opens on tiles, a tile drills in
to its tracks, and Songs shows the whole playlist without leaving it.

[frontend.md](../knowledge/frontend.md)'s browse-tab section states the old
rule in prose and needs both halves rewritten.
