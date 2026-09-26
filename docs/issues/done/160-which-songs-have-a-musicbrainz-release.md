# 160 — Which songs have a MusicBrainz release

Goal: a smart playlist of songs with no MusicBrainz release id, to work through.

- Song table column "MusicBrainz": ✓ where `tracks.release_mbid` is set, blank
  otherwise. Sortable (`SortField::ReleaseMbid`); untagged songs sort last in
  both directions, like every NULL. Not offered as a smart playlist's sort.
- `FilterField::ReleaseMbid`, `Boolean` kind like `Loved` ("MusicBrainz Release
  is" / "is not"), compiled to `release_mbid IS [NOT] NULL`.
  Forward-incompatible for exports; `docs/knowledge/export-schema.md`.

## Verification

- Column marks tagged songs, blank for untagged; sorting groups them.
- "MusicBrainz Release is not" lists exactly the untagged songs.
- Tagging a song via the MusicBrainz review drops it from that playlist.
- e2e: the fixture's Harbour carries a release id; `musicbrainz-column`
  captures the column.
