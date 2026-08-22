# 40 — Open Artist on… / Open Album on…

Merged in #64.

Two submenus on the song row's context menu, offering Last.fm and Discogs. They
come from `rowMenuItems`, so the Edit menu serves them too.

| | Last.fm | Discogs |
| --- | --- | --- |
| Artist | `/music/<artist>` | `/search/?q=<artist>&type=artist` |
| Album | `/music/<artist>/<album>` | `/search/?q=<artist> <album>&type=release` |

- **Album artist wins over artist** where both exist — it names a compilation's
  actual act, and it is what the album URL needs.
- **Discogs entries are searches**, because Discogs resolves artists and releases
  by numeric id; a path built from a name would 404.
- An entry is **absent when the row does not carry the tag** and **disabled with
  more than one row selected**, the rule Show in Explorer follows.
- Last.fm drops out of the album submenu when a row has an album and no artist:
  it addresses a release under its artist, so the URL would be `/music//Harbour`.
  Discogs searches text, so the album alone is still a real query. The plan did
  not say what to do here.
- The Edit menu is handed a row only when the selection is exactly one, which is
  also the only case in which the row is certain to be in the page cache
  (`trackById`). A selection of several has no single row to name.

**The capability grew to three allowed hosts**, which is the whole list of places
this app may send the user. `capabilities.test.ts` was reading the permissions as
`string[]`, and the opener entry is an object because it carries a scope — so a
row for it would have matched nothing and passed. It now maps to identifiers
first, asserts the scope is exactly those three patterns, and asserts every URL
the app can build falls under one of them.

The e2e spec drives the pointer route rather than the Edit menu, and stops at
opening the submenus: following an entry would open a browser on the runner.
