# 78 — Import the last.fm history

The history that predates this app. For the library this is measured against,
**237,572 scrobbles**. Stacks on [76](76-the-play-log.md), and
[84a](84a-what-you-have-heard.md) is empty without it.

Rows land in `plays` with `source = 'lastfm'`. Stats never ask where a row came
from.

## The API facts that shape it

- **`user.getRecentTracks` needs the `api_key` only**, no session key, and takes
  any username. The import therefore works before an account is connected, and
  for accounts that are not the user's.
- **`limit` caps at 200.** 237,572 scrobbles is **1,188 requests**; throttled to
  4/s, inside last.fm's 5-per-second average, that is five to six minutes.
- **Page backwards by `to=`, never by `page=`.** Page numbers reorder the moment
  a new scrobble lands mid-import. A descending timestamp cursor is stable, and
  persisted in `settings` it makes the import resumable: killed at page 900, it
  restarts at page 900.
- **`to = oldest_in_page`, inclusive.** The overlap re-fetches a few rows and
  `idx_plays_identity` eats them; the exclusive form silently loses scrobbles
  that share a second.
- **The `nowplaying` entry has no `date`** and is not a play. Skipped.
- `@attr total` and `totalPages` from the first response drive progress.
- **`extended=1`** adds the loved flag and the MBIDs at no extra request cost,
  and the MBIDs are what tell two bands of the same name apart.

An import is `INSERT OR IGNORE` on [76](76-the-play-log.md)'s identity index, so
a re-run is free and a play this app made cannot be counted twice.

## Mechanically, the shape the codebase has

A dedicated worker thread behind `lastfm::transport::Transport`, one transaction
per page, and bounded, resumable failure like the scrobble queue's attempt cap.
Nothing blocks a command handler or the scrobbler thread.

**Progress on `stats://import`**, the way a scan reports on `scan://progress`. A
new channel is consistent with [61](../done/61-one-status-channel.md) rather
than a breach of it: that phase collapsed the *frontend's* error and notice slots
into `useStatusStore` — which is where a failed import reports — and left each
long write its own `…//progress` event.

The surface goes in
[LastfmSettings.tsx](../../../src/features/lastfm/LastfmSettings.tsx): username
defaulting to the connected account, Import, progress, the last imported
timestamp, and Re-import from scratch.

`plays::resolve` runs once at the end, not per page.

Testing: against a mocked `Transport`, as every last.fm phase already is — a
resumed cursor, a duplicated boundary page asserted to insert nothing new, a
`nowplaying` entry asserted skipped, a mid-import failure asserted to leave the
cursor where a resume can use it, and a page whose oldest rows share a second
asserted not to lose any of them.
