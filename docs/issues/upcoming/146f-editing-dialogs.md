# 146f — Stories for the editing dialogs

Needs [146a](../done/146a-story-harness.md). Titles go under `Features/Editing`. The two
statistics dialogs are in 146g and 146h.

| Story file | Draws | Seed | States |
| --- | --- | --- | --- |
| `editor/TagEditor.stories.tsx` | `TagEditor` | props | one track; several tracks that disagree (mixed fields); a staged cover; writing, with `progress` |
| `smart/SmartPlaylistEditor.stories.tsx` | `SmartPlaylistEditor` | props | new (empty filter); one rule; nested groups under both combinators; an `order` with sort and limit |
| `tagsource/ReleaseLookup.stories.tsx` | `ReleaseLookup` | `useTagsourceStore` | one per `Stage` (`opening`, `searching`, `results`, `fetching`, `confirm`, `applying` with progress); `results` with no candidates, and with an `error` |
| `ui/TagCombobox.stories.tsx` | `TagCombobox` | `suggestTagValues` | closed, open with suggestions after typing in `play`, no match |
| `ui/GenreCombobox.stories.tsx` | `GenreCombobox` | `genreSuggestions` | closed, open with suggestions after typing in `play`, no match |

- `TagEditor` and `ReleaseLookup` draw covers through `coverUrl` and
  `stagedCoverUrl`. 146a answers both.
- `ReleaseLookup` renders nothing while `queue` is `null`, so every story seeds
  a queue.
- Both comboboxes debounce, so `play` waits for the list to open before it
  finishes.
- Add `editingHandlers` to `.storybook/handlers.ts`.

## Verification

- `npm run storybook`: every state in the table renders on both grounds, and
  each dialog sits over the canvas with its scrim.
