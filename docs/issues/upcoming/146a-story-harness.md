# 146a — A story harness for components that talk to Tauri

Only props-only primitives have stories. Most components in use read a zustand
store, call `src/ipc` on mount, listen to a Tauri event, or draw a cover through
`convertFileSrc`. Outside Tauri, `convertFileSrc` throws and `invoke` never
resolves. This issue adds the seam that 146d–146i build on. It ships with one
story.

## Files

All of this goes in `.storybook/`, not `src/`. Coverage includes `src/**/*.{ts,tsx}`
at 80%, and Vitest never runs this code. `tsconfig.json` already includes
`.storybook`.

- `.storybook/tauri.ts`: installs the mocks.
- `.storybook/stores.ts`: resets the stores.
- `.storybook/fixtures.ts`: holds the shared rows.
- `.storybook/handlers.ts`: holds one exported handler map per area
  (`crashHandlers`, `libraryHandlers`, `statsHandlers`, ...). This issue creates
  it with `crashHandlers`. Each of 146d–146h adds its area's map, and 146i puts
  them all together.

## Mocks

Set these up from a preview-level `beforeEach` in `preview.ts`, and tear them
down with `clearMocks()` in the function it returns:

- `mockIPC(handler, { shouldMockEvents: true })`. `handler` looks the command up
  in `context.parameters.ipc`, a `Record<string, (args) => unknown>` keyed on
  the string that `invoke` receives (`"last_crash"`, `"plugin:dialog|open"`),
  not on the `src/ipc` function name. Issues 146d–146i name `src/ipc`
  functions. The handler key is the command that function invokes.
  - If no handler matches, it throws `Error("no story handler for <cmd>")` and
    logs the same message with `console.warn`. The component's error path shows
    instead of a spinner that never stops.
  - Defaults shared by every story go in `parameters.ipc` in `preview.ts`.
    Storybook merges them with each story's own.
- `mockWindows("main")`, for `getCurrentWindow` / `getCurrentWebview`.
- Assign `window.__TAURI_INTERNALS__.convertFileSrc` directly after `mockIPC`:
  - `(hash, "cover")` returns a fixture cover.
  - `("staged", "cover")` returns a cover that is visibly different.
  - `mockConvertFileSrc` does not work here, because its `asset.localhost` URLs
    404 in a browser.
- A story emits events with `emit` from `@tauri-apps/api/event` in its `play`
  function. Listeners subscribe in effects, so they are ready before `play`
  runs.

## Stores

`.storybook/stores.ts` exports one array holding every `use*Store` in `src/`.
The preview `beforeEach` calls `store.setState(store.getInitialState(), true)`
on each one. Stores are module singletons, so without the reset one story's
state leaks into the next.

A story seeds state in its own `beforeEach` with `useXStore.setState({...})`. A
store added later has to be added to the array.

## Fixtures

`fixtures.ts` exports:

- `track(overrides)`: every `Track` field, typed against `src/ipc/bindings`.
- `playlist(id, name, trackCount)`, `smartPlaylist(...)`, `browseGroup(...)` and
  `releaseGroup(...)`.
- `LIBRARY`: about 40 tracks across 6 albums. At least one track has
  `missing_since` set. At least one album has no cover, and at least one title
  is long enough to truncate.
- A cover per album as an inline SVG `data:` URI. No binary assets.

The per-file `track()` helpers in tests stay where they are.

## The proof story

`src/features/crash/CrashNotice.stories.tsx`:

- `Crashed`: `last_crash` answers with a report.
- `NoCrash`: `last_crash` answers `null`, so the story is empty.
- `acknowledge_crash` and `reveal_crash_log` answer `null`.

## Docs

- In [testing.md](../../knowledge/testing.md) § Storybook: `parameters.ipc`,
  the store reset, where fixtures live, and emitting events from `play`.
- In [conventions.md](../../knowledge/conventions.md), extend the story bullet:
  a story seeds stores and IPC, never mocks a module.

## Verification

- `npm run storybook`: both CrashNotice stories render. Switch between them and
  back: `NoCrash` stays empty.
- Remove the `last_crash` handler: the console names the command.
