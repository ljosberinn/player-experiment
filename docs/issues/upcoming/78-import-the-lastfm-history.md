# 78 — Import the last.fm history

The history that predates this app. For the library this is measured against,
**237,572 scrobbles**. Stacks on [76](76-the-play-log.md), and
[84a](84a-what-you-have-heard.md) is empty without it.

Rows land in `plays` with `source = 'lastfm'`. Stats never ask where a row came
from.

## What 76 deferred to here

Two things, both because they are worthless until this phase has run.

### The MBID tier

```sql
ALTER TABLE tracks ADD COLUMN recording_mbid TEXT;
CREATE INDEX idx_tracks_recording_mbid ON tracks(recording_mbid)
    WHERE recording_mbid IS NOT NULL;
```

`plays.track_mbid` is a *recording* id, which is why the column is not called
`mbid`: `tracks` already carries `release_mbid` and `release_group_mbid` from
migration 8, and they are three different things. It is read off the file the
way those two are — a `Tags` field, `ItemKey::MusicBrainzRecordingId` in
`tags::read`, an entry in [write.rs](../../../src-tauri/src/tags/write.rs)'s
TXXX preservation list so a tag write does not drop it, and no backfill,
because nothing has ever written it.

`plays::resolve` gains its first tier on top of the `match_key` one 76 shipped:
a play with a `track_mbid` matching a track's `recording_mbid` wins, and the key
decides the rest. That is the difference between telling two bands of the same
name apart and not, and before this phase there is not one MBID in the table to
try it on. Partial index for the reason migration 8 gives: the column is null
for most of a library, and an index over those rows would cost writes to serve
no query.

### The loved set

```sql
CREATE TABLE lastfm_loved (
    match_key TEXT PRIMARY KEY
) WITHOUT ROWID;
```

76 argues loved off `plays`: it is the current state of a track rather than a
fact about a moment, and under `INSERT OR IGNORE` an imported value would freeze
at whatever the first import saw. `user.getLovedTracks` is the endpoint that
actually answers it — `api_key` only, same 1000-per-page paging, a few requests
for any realistic count — and the set is replaced wholesale on each import
rather than merged, because unloving a track is a thing that happens and a
merged set could never forget one.

Keyed by `match_key` and nothing else: loved is a fact about a song, and
[77](77-the-stats-query-layer.md) joins it to whatever the play resolved to.
`ListenQuery` gains its `loved: Option<bool>` here, with the set behind it.

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
- **`extended=1`** adds the MBIDs at no extra request cost, and the MBIDs are
  what tell two bands of the same name apart. It also carries a loved flag,
  which is ignored: it describes the track now, not the play then, which is why
  the set comes from `user.getLovedTracks` instead.

An import is `INSERT OR IGNORE` on [76](76-the-play-log.md)'s identity index, so
a re-run is free.

**That index is not what keeps a local play from being counted twice**, and 76
says why: last.fm autocorrects artist and title on the way in, `getRecentTracks`
returns the corrected spelling, and the corrected spelling computes a different
`match_key`. So the import also skips a row whose second already carries a
`source = 'local'` play — sound because within a second this app played exactly
one thing, and narrow enough to leave two last.fm rows sharing a second alone,
which the inclusive cursor above depends on. A test asserts a locally written
play is not re-imported under a name last.fm corrected.

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

The two additions get their own: a play whose `track_mbid` matches one track's
`recording_mbid` asserted to resolve to it over a competing key match, a
recording id asserted to survive a tag write, and a second loved import
asserted to drop a track the first one had.
