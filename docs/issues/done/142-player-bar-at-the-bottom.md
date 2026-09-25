# 142 — The player bar moves to the bottom

The 86px transport strip under the app bar becomes a bottom bar laid out like
Spotify's: what is playing on the left, the controls over the playhead in the
centre, volume on the right. Styling stays the app's own tokens and shapes;
only the arrangement follows Spotify.

Supersedes two settled placements, knowingly:
[38](38-mute-and-repeat.md) put repeat beside the volume, and
[102](102-love-a-track-from-the-app.md) ruled out a strip heart.

## Window order

App bar → body → status bar → player bar. Nothing below the player bar; the
status bar stays against the content whose summary it shows. The error popover
opens above its anchor.

## Left: what is playing

- Cover, then title over artist. **The album leaves the second line.**
- **Cover and title are single-click buttons** calling `showTrackGroup`. The
  double-click goes. The box keeps its ref.
- **The artist is a link to the artist drill-in** the track is filed under
  (`album_artist ?? artist`), via `showTrackArtist`. The label stays the track's
  own artist, so a compilation track labelled `Alice` opens `Various Artists` —
  Alice has no drill-in of her own there. A string like `Maeckes, JAW` is one
  link.
- **A heart after the text** (`PlayerLove` → `LoveButton`), toggling Love
  through `useLoveEntry` with the one id: present whenever a track plays,
  disabled with the menu's hint only with no artist/title, filled and accent
  when loved. Icons `love` / `loved`.

## Centre: controls over the playhead

Previous · Play · Next · Repeat above the scrubber, an empty slot the width of
Repeat left of the pill so Play stays centred over the rail. No shuffle. The
scrubber fills the column.

## Right: volume only

`PlayerVolume`, right-aligned. **The search field moves to the app bar**,
between the menus and the version.

## Layout

`.player-bar`: a grid at `minmax(0, 3fr) minmax(0, 4fr) minmax(0, 3fr)`, 100px
tall (the 64px pill over the 15px playhead needs the room), border on top.
Hidden-not-absent when idle still holds for the left column.

## Tests

- e2e: band order and heights; the bar's columns on one row with Play centred
  over the rail and the window; `player-bar-unloved` / `player-bar-loved`
  captures in `playback.test.ts` (`transport.test.ts` plays nothing).
- `App.renders.test.tsx`: a love renders no song table.
