# 40 — Open Artist on… / Open Album on…

Two submenus on the song row's context menu. Because `rowMenuItems()` is shared
with the Edit menu, they appear in both without extra work.

- **Open Artist on…** → Last.fm, Discogs
- **Open Album on…** → Last.fm, Discogs — present only when the row has an album.

| | Last.fm | Discogs |
| --- | --- | --- |
| Artist | `/music/<artist>` | `/search/?q=<artist>&type=artist` |
| Album | `/music/<artist>/<album>` | `/search/?q=<artist> <album>&type=release` |

Discogs resolves artists and releases by numeric id, not by name, so a search URL
is the honest link rather than a guess that 404s.

- **Album artist wins over artist** where both exist — it identifies a
  compilation's actual act and it is what the album URL needs.
- Every component percent-encoded; `+` and `&` in band names are the normal case.
- Disabled with more than one row selected; absent when the field is empty.
- Goes through `tauri-plugin-opener`, whose capability scope grows to include
  `https://www.last.fm/*` and `https://www.discogs.com/*` — three allowed hosts
  total, which is the whole list of places this app may send the user.

**e2e:** the embedded driver delivers no `contextmenu` event. Dispatch the event
React listens for with the trigger's own coordinates —
`e2e/specs/smart-playlists.test.ts` has the helper. Driving the submenus through
the Edit menu tests the same `rowMenuItems()` but not that a right-click reaches
it.

Tests: URL construction incl. encoding, album-artist preference, disabled states.
