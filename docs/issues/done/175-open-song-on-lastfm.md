# 175 — Open Song on… Last.fm

A third lookup submenu after *Open Album on…*, as in
[40](../done/40-open-artist-album-links.md): *Open Song on…* › *Last.fm*,
`https://www.last.fm/music/<artist>/_/<title>`, both parts encoded.

- **Track artist, not `linkArtist`.** A compilation's album artist is not
  who performed the song, and scrobbles go out under the track artist.
  `album_artist` only when `artist` is blank.
- Absent without an artist or a title; disabled with more than one row.
- No Discogs entry: it has no page per song.
- `LinkableTrack` gains `title`.
- `capabilities.test.ts`: the song URL falls under the `www.last.fm/*` scope.

## Verification

- A compilation track opens the performer's song page, not *Various Artists*'.
- A title with `&`, `/` or `?` opens the right page.
