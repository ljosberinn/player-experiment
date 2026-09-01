# 62 — One invalidation channel

Every mutation reaches across stores to say what it invalidated.
`playlists/store.ts` calls `useLibraryStore.getState()` twelve times -
`refresh`, `showPlaylist`, `clearSelection`, `forgetPlaylist`, each guarded by
its own "is this playlist the open one" check - and `editor/store.ts` and
`scan.ts` do the same. Ordering is load-bearing and stated in comments
(`remove` must leave the playlist before the sidebar drops it). Every new
mutation is another chance to forget one of these, and forgetting is silent.

The channel meant for this exists and is nearly unused. `library://changed` is
emitted from exactly two places in the backend: the e2e `seed_synthetic_tracks`
command and the missing-mark clear in `lib.rs`. Nothing else - not a scan, not
a tag write, not a playlist edit - emits it.

Two things follow. The frontend's comments about it are wrong: `playlists`
debounces its recount at 250ms because "a scan emits `library://changed` far
more often than anyone can read a number", and a scan does not emit it at all.
And the subscription that debounce protects never fires for the case it was
written for, so the count beside each playlist is stale after a scan until
something else reloads the sidebar.

Emitting it from every write and letting each store invalidate itself removes
the twelve reach-arounds, the ordering, and the difference between a change
this window made and one it did not.

To decide:

- **What the event carries.** A bare ping means a tag write on one track
  re-queries the whole view and recounts every smart playlist. Scope
  (`{ tracks, playlists }`, ids where cheap) is what keeps that proportionate,
  and is a payload two stores then have to agree on.
- **What stays a direct call.** `showPlaylist(null)` after a delete and
  `forgetPlaylist` are navigation, not invalidation - an event cannot express
  "leave this view before it stops existing". Those stay; the refreshes go.
- **Whether emitting per write is too often.** Tag writes emit `TAG_PROGRESS`
  per track already; a `library://changed` per track would re-query per track.
  Emit once per batch, or debounce on the receiving side as the sidebar does.
- Whether the library store's own subscription replaces `App`'s
  (`onLibraryChanged` at `App.tsx`), which is the only one today.

Backend work first: the emit sites. The frontend cleanup is worth nothing
until every write announces itself.
