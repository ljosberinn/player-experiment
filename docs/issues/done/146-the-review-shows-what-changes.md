# 146 — The review shows what changes

MusicBrainz lookup ([ReleaseLookup.tsx](../../../src/features/tagsource/ReleaseLookup.tsx)).

- No mapping table until a release is picked.
- Files an apply would leave as they are (`agrees`: ticked title, artist,
  track and disc number) move to a closed `<details>`, `Unchanged · N`, below
  the rest. Arrows swap within a group.
- The MusicBrainz cell colours what an apply would change (`--accent`):
  numbers whole, a title or artist only in the characters that differ. The
  artist shows whenever it changes.
- Waiting lines: `Reading your files…`, `Searching MusicBrainz…`,
  `Reading the tracklist…`.

## Verification

- While searching and on the candidate list, the pane has no table.
- A release whose files are already tagged correctly shows them under
  `Unchanged · N`, folded; the rows above are the ones that differ. Opened,
  its columns line up with the table above.
- Unticking Title moves a row whose only difference is its title into
  Unchanged.
- A changed title, number or artist is accent-coloured on the MusicBrainz side;
  unticking its field removes the colour.
- "Remember Me" against "Remember Me (Forever)" marks only " (Forever)".
