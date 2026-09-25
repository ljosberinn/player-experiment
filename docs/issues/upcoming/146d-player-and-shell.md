# 146d — Stories for the player bar and the shell

Needs [146a](../done/146a-story-harness.md). Titles go under `Features/Player` and
`Features/Shell`.

State is seeded through the stores and IPC is answered by `parameters.ipc`, as
146a sets up. `NowPlaying`, `Transport`, `Scrubber`, `VolumeControl` and
`RepeatButton` are the presentational halves of the `Player*` wrappers. The
first gets its states here, and 146c covers the other four.

| Story file | Draws | Seed | States |
| --- | --- | --- | --- |
| `player/PlayerBar.stories.tsx` | `NowPlayingStatus` (and `NowPlaying` through it), `PlayerTransport`, `PlayerScrubber`, `PlayerVolume`, `PlayerRepeat`, laid out the way `App.tsx` lays them out | `usePlayerStore` | nothing loaded; playing with a cover; paused with no cover and a truncating title; muted with repeat on |
| `shell/DynamicBackground.stories.tsx` | `DynamicBackground` behind a surface | `usePlayerStore.palette`, `useDynamicBackgroundStore.enabled` | on with a palette, on with none, off |
| `library/ScanBar.stories.tsx` | `ScanBar` | `scan://progress` from `play` | idle, scanning part way |
| `shell/BackgroundTaskProgress.stories.tsx` | `BackgroundTaskProgress` | `task://progress` from `play` | idle, running |
| `shell/TaskProgress.stories.tsx` | `TaskProgress` | `export://progress` and `tags://progress` from `play`; `useLastfmStore.importing` / `importProgress` | idle, exporting, writing tags, last.fm import |
| `shell/AppMenus.stories.tsx` | `AppMenus` | `useLibraryStore` selection and playlist | no selection, several tracks selected, inside a playlist; each with one menu opened by `play` |
| `shell/SettingsDialog.stories.tsx` | `SettingsDialog`, and through its tabs `LibraryFolderSettings`, `WatchFolderSettings` and `LastfmSettings` | zoom, theme, dynamic-background and lookup stores; `useLastfmStore` | one story per tab (`appearance`, `library`, `online`, `about`), selected by `play`; `online` also with last.fm not configured, connected, and importing |

`NowPlayingStatus` requires a `ref`. Give it one from `useRef` in the story.

## IPC to answer

Add `playerHandlers` and `shellHandlers` to `.storybook/handlers.ts`:

- Settings calls `loadUnattendedLookup`, `loadLibraryFolder`, `countTracks`,
  `listWatchFolders`, `loadWatchInterval` and `revealMainLog`.
- The save and remove actions of those tabs should answer as well, so that
  clicking around a story does not throw.
- The folder picker is `plugin:dialog|open`. Answer it `null`.

## Verification

- `npm run storybook`: every state in the table renders on both grounds.
- Progress stories draw their bar without a reload.
