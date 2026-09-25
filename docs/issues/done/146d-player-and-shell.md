# 146d — Stories for the player bar and the shell

Needs [146a](146a-story-harness.md), stacked on [146c](146c-chrome.md) for
`PLAYLISTS`. Titles go under `Features/Player`, `Features/Shell` and
`Features/Library`.

State is seeded through the stores and IPC is answered by `parameters.ipc`.

| Story file | Draws | Seed | States |
| --- | --- | --- | --- |
| `player/PlayerBar.stories.tsx` | `NowPlayingStatus`, `PlayerLove`, `PlayerTransport`, `PlayerRepeat`, `PlayerScrubber`, `PlayerVolume`, laid out as `App.tsx` lays them out | `usePlayerStore`, `useLovedStore` | nothing loaded; playing a loved song with a cover; paused with no cover and a truncating title; muted with repeat on |
| `shell/DynamicBackground.stories.tsx` | `DynamicBackground` behind the sidebar and content pane | `usePlayerStore.palette`, `useDynamicBackgroundStore.enabled` | on with a palette, on with none, off |
| `library/ScanBar.stories.tsx` | `ScanBar` | `scan://progress` from `play` | idle, scanning part way |
| `shell/BackgroundTaskProgress.stories.tsx` | `BackgroundTaskProgress` at the sidebar's foot | `task://progress` from `play` | idle, running |
| `shell/TaskProgress.stories.tsx` | `TaskProgress` | `useExportStore.busy` plus `export://progress` from `play`; `useLastfmStore.importing` / `importProgress` | idle, export before its first event, exporting, last.fm import |
| `shell/AppMenus.stories.tsx` | `AppMenus` | `useLibraryStore` selection, cached page, stats and `playlistId`; `usePlaylistsStore`; `useLastfmStore` | no selection, several selected, inside a static playlist; each with Edit opened by `play` |
| `shell/SettingsDialog.stories.tsx` | `SettingsDialog` and its sections | the `category` arg; `useLastfmStore` | one story per category; `online` also not configured, connected, and importing |

A tag write has no `TaskProgress` state: it reports in its own dialog.

## IPC

`.storybook/handlers.ts`:

- `playerHandlers`: the `player_*` commands and `set_loved`. The backend
  answers a player command with a `player://state` event, so toggle, mute and
  repeat write the new state to the store themselves.
- `shellHandlers`: every load and save in Settings, `plugin:dialog|open`
  (`null`), `plugin:opener|open_url`, `plugin:webview|set_webview_zoom`, and
  last.fm connect, which never completes, and import.

## Verification

- `npm run storybook`: every state in the table renders on both grounds.
- Progress stories draw their line without a reload.
- In `PlayerBar`, Play, Mute and Repeat answer a click.
