# 78 — Import the last.fm history

The history that predates this app. For the library this is measured against,
**237,572 scrobbles**. Stacks on [76](76-the-play-log.md) and
[77](77-the-stats-query-layer.md), and
[84a](../upcoming/84a-what-you-have-heard.md) is empty without it.

Rows land in `plays` with `source = 'lastfm'`. Stats never ask where a row came
from.

## What 76 deferred to here

Two things. One of them turned out not to exist.

### The MBID tier, measured and dropped

76 deferred a `tracks.recording_mbid` column and a matching tier above the
`match_key` one, on the reasoning that an id beats a string where last.fm has
autocorrected a spelling. It was built, and then measured against the real
history before the branch was merged. It does not work, and no work on this
side can make it:

- **Coverage is fine.** 75.5% of 7,863 sampled scrobbles, spread over all 1,189
  pages of the history, carry a recording id.
- **Agreement is not.** Where the play's key named a file that also carries a
  recording id, last.fm's id was the file's in 11 of 78 cases — 14%.
- **Lift is zero.** Of 2,511 sampled plays the key could not link, 1,294 carry
  an id, and not one of them matched any of the 5,465 ids in the library.
- **Because most of them are not recording ids at all.** A third of the
  disagreeing ids are UUIDv3, MusicBrainz's pre-NGS track ids. Probed against
  MusicBrainz, every one tried came back 404 — as a recording, a release, a
  release group and a work. Picard's ids resolve.

So there is no `tracks.recording_mbid`, no partial index, and no tier.
`plays.artist_mbid` and `plays.track_mbid` are still written by the import,
because 76 argues they are part of what a play was; nothing matches on them.

A separate measurement, of whether this app's own lookup could supply the ids
instead, is what makes the second half of that conclusion firm: over 100
Picard-tagged releases, the ids the lookup would have written agreed with
Picard's 97.6% of the time. The ids we could produce are good. The ids last.fm
sends are the problem.

### The release-id backfill, which stays

The measurement turned up a defect that has nothing to do with statistics.
Migration 8 assumed nothing had written `release_mbid` and
`release_group_mbid`, so it did not backfill. Picard had: about 9% of the
measured library carries both, and a scan never re-reads a file whose mtime and
size are unchanged, so none of them had ever reached the rows. The lookup pass
therefore searched those releases — two rate-limited requests each — and wrote
its own verdict over Picard's.

`scan::read_musicbrainz_ids` is a one-shot thread shaped like
`covers.normalize`. It reads both ids off every file, fills **only empty
columns** so a lookup's verdict stays, holds the scan lock a chunk at a time,
resumes after a quit, and sets a flag when it finishes. `release_type` stays
out of it: Picard writes it lowercase and with secondary types, and it names
the mover's folder — see [93](../upcoming/93-picard-release-types.md).

### The loved set

```sql
CREATE TABLE lastfm_loved (
    match_key TEXT PRIMARY KEY
) WITHOUT ROWID;
```

76 keeps loved off `plays` because it is the current state of a track, not a
fact about a moment. `user.getLovedTracks` (`api_key` only, 1000 per page)
provides the set. The set is fetched in full after the history, then replaced
in one transaction, so a failed fetch keeps the old set. Unloving happens, and
a merged set could never forget one.

`ListenQuery` gains `loved: Option<bool>`: `plays.match_key IN lastfm_loved`.

## The API facts that shape it

- **`user.getRecentTracks` needs the `api_key` only**, no session key, and takes
  any username. The import therefore works before an account is connected. It
  needs a build with a key.
- **`limit` caps at 200.** 237,572 scrobbles is **1,188 requests**. Throttled to
  4/s, inside last.fm's 5-per-second average, that is at least five minutes.
- **Page backwards by `to=`, never by `page=`.** Page numbers shift the moment a
  new scrobble lands mid-import. A descending timestamp cursor is stable, and
  persisted in `settings` it makes the import resumable.
- **`to = oldest_in_page + 1`.** last.fm does not document whether `to` is
  inclusive. The `+ 1` overlaps under either reading, `idx_plays_identity`
  drops the re-fetched rows, and scrobbles sharing the boundary second are not
  lost. A page that is one second throughout cannot advance that way, so the
  cursor steps to `oldest_in_page`.
- **Done when a response's `totalPages` is 1 or less.** The overlap means a page
  is never empty on its own.
- **One track comes back as an object**, not an array of one.
- **The `nowplaying` entry has no `date`** and is not a play. Skipped.
- **Plain, not `extended=1`.** The plain response already carries the artist,
  album and track MBIDs. `extended` adds only a loved flag, which describes the
  track now, not the play then.
- Error **8** ("operation failed") is routine on deep pages and is retried,
  along with the transient set. **6** (no such user) and **17** (listening
  history is private) are stopped on with a message saying so.

## Runs

A run belongs to one username. It pages from the newest scrobble down to a
floor. The first run has no floor. A finished run stores the newest timestamp
it saw as the next run's floor (`from=`), so a later Import fetches only what
is new. A different username starts from nothing.

**Re-import from scratch** deletes every `source = 'lastfm'` row and the run
state, in one transaction, and starts over. That is how scrobbles deleted on
last.fm leave. Local rows stay.

An import is `INSERT OR IGNORE` on [76](76-the-play-log.md)'s identity index,
so re-fetched rows are free.

**That index is not what keeps a local play from being counted twice**, and 76
says why: last.fm autocorrects artist and title, so the returned spelling
computes a different `match_key`. The import also skips a row whose second
already carries a `source = 'local'` play. That is sound because within a
second this app played exactly one thing, and narrow enough to leave two last.fm
rows sharing a second alone.

## Mechanically

A dedicated worker thread behind `lastfm::transport::Transport`, with one
transaction per page. The throttle is injected, so tests do not sleep. Each page
gets three attempts with backoff. After that the run stops with its cursor
kept, and the next Import resumes from it. Nothing blocks a command handler or
the scrobbler thread. One run at a time.

`plays::resolve` runs once when a run ends, finished or not. Rows before it are
unlinked, not wrong. `library://changed` is announced then.

**Progress on `lastfm://import`**, beside the `lastfm://` events that exist. A
new channel is consistent with [61](61-one-status-channel.md): that phase put
the frontend's error and notice slots into `useStatusStore`, which is where a
failed import reports, and left each long write its own progress event.
`TaskProgress` draws it too, so closing Settings mid-import does not hide it.

The surface goes in
[LastfmSettings.tsx](../../../src/features/lastfm/LastfmSettings.tsx): the
username (defaulting to the connected account), Import (Resume when a cursor is
stored), progress, the last imported timestamp, and Re-import from scratch.

## Testing

Against a mocked `Transport`, as every last.fm phase already is. Cases:

- a resumed cursor
- a duplicated boundary page that inserts nothing new
- a `nowplaying` entry that is skipped
- a single-track page
- a mid-import failure that leaves the cursor where a resume can use it
- a page whose oldest rows share a second, with none of them lost
- a one-second page that still advances
- a second run that asks with `from=`
- from scratch dropping imported rows and keeping local ones
- a locally written play not re-imported under a name last.fm corrected

For the additions:

- an imported play carries the ids it was sent and is linked by its key
- the backfill fills both columns, runs only once, and leaves an id the row
  already has
- a second loved import drops a track the first one had
- a failed loved fetch keeps the old set
