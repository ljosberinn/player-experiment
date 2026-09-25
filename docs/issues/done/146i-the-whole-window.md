# 146i — A story of the whole window

Needs 146d–146h. `src/App.stories.tsx`, titled `App`.

The per-component stories never show the whole composition, on both grounds,
without Tauri. This story does, by rendering `App` over every area map in
`.storybook/handlers.ts`, merged.

## IPC to answer on mount

Beyond the area maps, `App` calls these on mount. They are `appHandlers`:

- `get_app_info`, `load_dynamic_background`, `lastfm_status` and
  `player_snapshot` (`SILENT`).
- `load_window_geometry`, `load_zoom` and `load_theme`, from
  `useWindowGeometry`. `load_theme` answers the `data-theme` the toolbar
  wrote, so the app's restore keeps the chosen ground.
- `plugin:window|show` and `plugin:window|set_title`. `mockWindows("main")`
  only names the window; each call on it is still a command.
- `plugin:global-shortcut|register` and `unregister`, for
  `useGlobalMediaKeys`.
- `plugin:updater|check`, answered `null`.

`plugin:event|listen` is answered by `shouldMockEvents`, which covers the
subscriptions and `onDragDropEvent`.

The story answers `last_crash` with `null`: `crashHandlers` reports a crash,
and its alert makes the window inert.

## Stories

- `Library`: `LIBRARY` in the song table, with a track playing.
- `Statistics`: switched to the statistics view in `play`.
- `FirstRun`: an empty library, with no folder set.

## Verification

- `npm run storybook`: all three stories render on both grounds.
- The console shows no `no story handler for` warning.
