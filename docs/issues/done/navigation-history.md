# Back and forward

The mouse's side buttons do nothing. So would Alt+← — there is nothing for them
to do, which is the actual issue: the app has no history.

Where the user is is spread across four independent pieces of library store
state — `tab`, `browse`, `playlistId` and `search` — each written by the thing
that changes it, none of them recorded. Handling mouse button 3 and 4 is a
`pointerdown` filter and the smallest part of this.

## What a history entry is

`{ tab, browse, playlistId }`.

Selection is not in it: going back to an album and finding a different row
highlighted is worse than going back and finding the album.

`search` is excluded rather than coalesced. It changes per keystroke, and a
hundred entries per typed query is not history; the field is on screen and
clearing it is one gesture.

Sort is excluded from the entry but derived when one is applied, not ignored —
otherwise back into an album lands sorted by artist. An album drill-in opens on
`trackNo`, everything else on `defaultSortFor(playlistId)`, which is what the
actions do today. Under an active search the sort stays `relevance` and
`sortBeforeSearch` re-points at the new entry's default, so clearing the box
lands in the new view's natural order rather than the previous view's.

## `applyEntry`

Every one of those fields is written today by an action that also awaits
`refresh()`. Navigating back has to set them at once and refresh once — the
same problem the polish pass's reveal-what-is-playing entry hits from the other
side, and for the same reason: `openGroup` refuses to act when `tab` is
`songs`, so replaying a state cannot be done by calling the actions that
produced it.

One internal store action, `applyEntry(entry, record)`:

1. no-op if the entry equals the current view;
2. one `set` of `tab`, `browse`, `playlistId`, `selection`, `groups` and the
   derived sort;
3. across a playlist boundary only: cancel the search debounce, clear
   `search`, `searchInput` and `sortBeforeSearch`, `await loadColumns()` —
   `showPlaylist`'s reset today, and columns are stored per view;
4. push the entry, or move the index when replaying one;
5. one `refresh()`.

`showTab`, `openGroup`, `closeGroup` and `showPlaylist` become entry
constructors over it; back and forward call it with `record: false`. The
`tab === "songs"` guard stays in `openGroup` rather than moving into
`applyEntry` — that is what lets reveal-what-is-playing apply
`{ tab: "albums", browse }` directly. `showLibraryView` in `App.tsx` collapses
from two awaits to one entry, so leaving a playlist for Songs is one refresh
and one history entry instead of two.

The stack itself is a list and an index, in `src/features/library/history.ts`,
pure and alongside `selection.ts` and `columns.ts`. The state lives in the
library store rather than a store of its own: a second one holding a copy of
those fields would drift out of step with them.

`remove` in the playlists store already imports the library store, so deleting
a playlist calls `forgetPlaylist(id)` — drop its entries, clamp the index. Back
cannot land on something gone.

## Entry points

- Mouse buttons 3 and 4. `pointerdown` on the window, not `auxclick` — Windows
  fires those buttons through both and the click arrives after the browser has
  already decided nothing happened.
- Alt+← and Alt+→. Both gestures in a `useHistoryShortcuts` hook beside
  `useLibraryShortcuts`, behind pure mappers the way `libraryShortcutFor` is.
  The side buttons navigate from inside the search box; Alt+arrows do not.
- `‹ ›` in the sidebar's top edge, above `LibraryNav`. CSS chevrons like the
  other sidebar icons, so this does not wait on the polish pass's icon library;
  each disabled when that direction is empty, `title` naming the destination.
  The drill-in breadcrumb keeps the meaning it has.

## Testing

`history.ts` and the two gesture mappers test without a DOM. The store test
covers one refresh per navigation, columns reloaded only across a playlist
boundary, and the derived sort. E2E screenshot of the sidebar arrows, enabled
and disabled.
