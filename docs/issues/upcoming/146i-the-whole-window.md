# 146i — A story of the whole window

Needs 146d–146h. `src/App.stories.tsx`, titled `App`.

The per-component stories never show the whole composition, on both grounds,
without Tauri. This story does, by rendering `App` over every handler map in
`.storybook/handlers.ts`, merged.

## IPC to answer on mount

Beyond the area maps, `App` calls these on mount. Add them as `appHandlers`:

- `getAppInfo`, `loadDynamicBackground`, `lastfmStatus`,
  `lovedTracks` and `playerSnapshot`.
- The updater's `plugin:updater|check`. Answer `null`.
- `plugin:event|listen`, which `shouldMockEvents` already answers, for the
  `connect` and `watch` subscriptions.
- `getCurrentWindow`, which `mockWindows("main")` covers, for
  `useWindowGeometry` and `useWindowTitle`.
- `getCurrentWebview().onDragDropEvent`, for `useFileDrops`.

## Stories

- `Library`: `LIBRARY` in the song table, with a track playing.
- `Statistics`: switched to the statistics view in `play`.
- `FirstRun`: an empty library, with no folder set.

## Verification

- `npm run storybook`: all three stories render on both grounds.
- The console shows no `no story handler for` warning.
