# 146f — Stories for the editing dialogs

Needs [146a](146a-story-harness.md); stacked on [146e](146e-library.md) for
the shared `.storybook/` files. Titles go under `Features/Editing`, with
`WriteLine` moved there from `Features/Editor`. The two statistics dialogs
are in 146g and 146h.

| Story file | Draws | Seed | States |
| --- | --- | --- | --- |
| `editor/TagEditor.stories.tsx` | `TagEditor` | props | one song; three songs over two albums (mixed fields, artwork differs); a staged cover, from Choose Artwork in `play`; writing, with `progress` |
| `smart/SmartPlaylistEditor.stories.tsx` | `SmartPlaylistEditor` | props | new; one rule; nested groups under both combinators, every value shape; sorted and limited |
| `tagsource/ReleaseLookup.stories.tsx` | `ReleaseLookup` | `useTagsourceStore` | one per `Stage` on a selection (`applying` with progress); `results` with no candidates, and with an `error`; the review queue; nothing selected |
| `ui/TagCombobox.stories.tsx` | `TagCombobox` | `suggestTagValues` | closed, suggesting after typing in `play`, no match, no vocabulary (plain input) |
| `ui/GenreCombobox.stories.tsx` | `GenreCombobox` | `genreSuggestions` | closed, suggesting after typing in `play`, no match |

- The staged cover is the editor's own state, so only Choose Artwork reaches
  it: `onPickCover` resolves, and `stagedCoverUrl` draws `STAGED_COVER`.
- The stages between requests pass in a moment, so `ReleaseLookup` stories
  seed the store instead of stepping through its actions.
- The comboboxes sit in a `Dialog`, laid out as their hosts lay them out:
  only `.dialog input` styles their field.
- No match looks the same as closed: the list only opens with items in it.
- Fixtures: `HARBOUR_LIGHTS`, three `CANDIDATES`, and `HARBOUR_LIGHTS_DETAIL`,
  which changes four files and leaves three alone; `SELECTION` and
  `REVIEW_QUEUE`; `GENRES`.
- `editingHandlers` in `.storybook/handlers.ts`: suggestions over `LIBRARY`
  and `GENRES`, and the tag, fetch, apply and set-aside commands.

## Verification

- `npm run storybook`: every state in the table renders on both grounds, and
  each dialog sits over the canvas with its scrim.
- Clicking a candidate, a mapping arrow, Save or Apply logs no
  `no story handler for` warning.
