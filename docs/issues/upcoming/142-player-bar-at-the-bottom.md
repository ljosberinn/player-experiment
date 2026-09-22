# 142 — The player bar moves to the bottom

The 78px transport strip under the app bar becomes a bottom bar laid out like
Spotify's: what is playing on the left, the controls over the playhead in the
centre, volume on the right. Styling stays the app's own tokens and shapes;
only the arrangement follows Spotify.

Supersedes two settled placements, knowingly:
[38](../done/38-mute-and-repeat.md) put repeat beside the volume, and
[102](../done/102-love-a-track-from-the-app.md) ruled out a strip heart.

## Window order

App bar → body → status bar → player bar. Nothing below the player bar; the
status bar stays against the content whose summary it shows.

## Left: what is playing

- Cover, then title over artist. **The album leaves the second line.**
- **Cover and title are single-click buttons** doing what the double-click on
  the box does today (`showTrackGroup`). The double-click goes. The box keeps
  its ref — the error popover anchors on it.
- **The artist is a link to the artist drill-in** the track is filed under:
  `album_artist ?? artist`, the `GROUP_ARTIST` rule `entryForTrack` already
  follows. A string like `Maeckes, JAW` is one link; nothing in the data model
  splits artists. Needs a store action alongside `showTrackGroup`, since that
  one prefers the album.
- **A heart after the text, toggling Love** for the playing track through the
  local loved store. Depends on
  [134](134-love-is-kept-in-the-library.md). Same rules as the menu entry, via
  `lovingFor` with the one id: present whenever a track plays, with or without
  last.fm; disabled with its hint only with no artist/title. Filled and accent
  when loved. Its own component subscribing to `loved`, so a love re-renders
  the heart and not `App`. Icons `love` / `loved` in `registry.tsx` (Phosphor
  `Heart`, regular / fill).

## Centre: controls over the playhead

A row of Previous · Play · Next · Repeat above the scrubber. An empty slot the
width of Repeat sits left of Previous, so Play stays centred over the rail. No
shuffle. The scrubber keeps elapsed left and total right.

## Right: volume only

`PlayerVolume`, right-aligned. **The search field moves to the app bar**,
between the menus and the version — `SearchBox` itself is unchanged; its field
height may need to come down to sit in a 36px bar.

## Layout

Three columns (Spotify's is 30% / 40% / 30%), so the centre stays centred in
the window whatever the left column holds. The two `strip-gap` spacers go.
Hidden-not-absent when idle still holds for the left column. Height stays 78px
if the stacked centre fits; otherwise the band assertion moves with it. Border
moves to the top edge.

## Tests that move with it

- `appearance.test.ts`: the band order and heights, and the one-row test,
  which no longer describes the centre column.
- `App.css.test.ts`: the fixed-height strip rule and `PANES`.
- `chrome.test.tsx`: `NowPlaying` dblClick → click on cover and title; the
  artist link; the heart's unloved / loved / disabled (no artist/title) states.
- `App.renders.test.tsx`: a love renders no song table.
- `transport.test.ts`'s `transport-mute-repeat` capture is re-shot, now with
  the unloved heart. The keyless CI build can drive it, so the spec also
  clicks the heart and captures it filled.
- Any e2e selector on `.transport-strip` if the class is renamed.

## Docs

`design.md` Layout (app bar, strip, status bar lines), `frontend.md`'s
`NowPlaying` bullet, the placement comments in `app.css` and `App.tsx`.
