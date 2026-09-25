# 160 — Which songs have a MusicBrainz release

Goal: a smart playlist of songs with no MusicBrainz release id, to work through.

- Song table column showing whether `tracks.release_mbid` is set; sortable.
- `FilterField` arm for it, `Boolean` kind like `Loved` ("is" / "is not").
  Forward-incompatible for exports; update `docs/knowledge/export-schema.md`.

## Verification

- Column marks tagged songs, blank for untagged; sorting groups them.
- "MusicBrainz release is not" lists exactly the untagged songs.
- Tagging a song via the MusicBrainz review drops it from that playlist.
- Screenshots refreshed.
