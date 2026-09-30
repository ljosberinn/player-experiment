# 190 — Vitest stands in for Tauri

A test that misses a `vi.mock` reaches a Tauri that is not there, and the
caller swallows the rejection. `src/ipc/index.test.ts` stubs `invoke` and
`listen` themselves, and 7 of the 13 `on*` wrappers have no test.

Component and store tests keep mocking `src/ipc`: that seam is typed, and
command names stay asserted in one file.

## Shape

- `src/test/setup.ts`: `mockIPC` in a `beforeEach` that records the command and
  rejects with `unmocked IPC: <cmd>`; `clearMocks` in the `afterEach`, which
  then fails the test on anything recorded.
- `App.test.tsx`, `App.renders.test.tsx`: mock
  `@tauri-apps/plugin-global-shortcut`, which every App test reached.
- `useGlobalMediaKeys.ts`, `useUpdater.ts`: one shared `import()` per plugin.
  Vitest 5 resolves concurrent imports of a `vi.mock`ed module to the real one.
- `src/ipc/index.test.ts`: no `vi.mock` of `@tauri-apps/api/*`. `mockIPC` with
  a spied handler, `shouldMockEvents` and a real `emit` for every `on*`
  wrapper, `mockWindows` for `onFileDrop`, `mockConvertFileSrc("windows")`.
- `docs/knowledge/testing.md`: the fallback and the import rule.

## Verification

- Delete the `@tauri-apps/plugin-updater` mock from `App.test.tsx`: the failure
  names `plugin:updater|check`.
- Break an `on*` wrapper's payload unwrapping: its test goes red.
