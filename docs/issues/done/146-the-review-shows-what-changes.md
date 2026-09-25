# 146 — The review shows what changes

MusicBrainz lookup ([ReleaseLookup.tsx](../../../src/features/tagsource/ReleaseLookup.tsx)).

- No mapping table until a release is picked.
- Files an apply would leave as they are (`agrees`: ticked title, artist,
  track and disc number) move to a second group, `Unchanged · N`, below the
  rest. Arrows swap within a group.
- Waiting lines: `Reading your files…`, `Searching MusicBrainz…`,
  `Reading the tracklist…`.

## Verification

- While searching and on the candidate list, the pane has no table.
- A release whose files are already tagged correctly shows them under
  `Unchanged · N`; the rows above are the ones that differ.
- Unticking Title moves a row whose only difference is its title into
  Unchanged.
