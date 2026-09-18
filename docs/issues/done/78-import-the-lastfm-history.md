# 78 — Import the last.fm history

The history that predates this app. For the library this is measured against,
**237,572 scrobbles**. Stacks on [76](76-the-play-log.md) and
[77](77-the-stats-query-layer.md), and
[84a](../upcoming/84a-what-you-have-heard.md) is empty without it.

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
way those two are: a `Tags` field, `ItemKey::MusicBrainzRecordingId` in
`tags::read`, the scan's insert and update, and `sync_row`.

**No entry in [write.rs](../../../src-tauri/src/tags/write.rs)'s TXXX list.**
lofty 0.25 maps the key to and from the ID3v2 `UFID` frame owned by
`http://musicbrainz.org`, which is where Picard writes it. A round-trip test
asserts that a tag write keeps it.

**Backfilled, unlike migration 8's ids.** Those two came from this app's own
writer. Recording ids came from Picard: 12% of a 300-file sample of the
measured library carries one, and the scan never re-reads a file whose mtime and
size are unchanged, so without a backfill the tier would match nothing. The
backfill is a one-shot thread shaped like `covers.normalize`. It reads the id
only, never touches covers or other columns, resumes after a quit, and sets a
settings flag when it finishes.

`plays::record` snapshots `tracks.recording_mbid` into `plays.track_mbid`, so a
local play of a tagged file carries the id too.

`plays::resolve` gains a first tier above the `match_key` one 76 shipped: a play
whose `track_mbid` matches a track's `recording_mbid` resolves to that track,
using the same present-then-lowest-id tiebreak, and the key decides the rest.
What the tier catches is last.fm's autocorrect. A file tagged `Motorhead`
never key-matches an imported `Motörhead`, but both carry the same recording
id. The index is partial for the reason migration 8 gives.

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

- a play whose `track_mbid` matches one track's `recording_mbid` resolves to it
  over a competing key match
- a recording id survives a tag write
- the backfill fills the column and runs only once
- a second loved import drops a track the first one had
- a failed loved fetch keeps the old set
