# 61 — One status channel

`set({ error: String(cause) })` appears twenty-seven times across six stores -
library (7), playlists (11), editor (3), player (2), scan (2) and updater (2) -
each in its own `try`/`catch` around an `ipc` call. Five of them reach the
screen: `App` merges them into `problem` (first of five), `dismissProblem`
clears all five, and holding both takes ten subscriptions (`App.tsx:95-129`).
The sixth is never shown - a failed update check usually means the machine is
offline - and is read by nothing but its own test.

Notices are the same shape one size smaller: `playlists.notice`,
`editor.notice` and `App`'s own `toolbarNotice` share one line, four more
subscriptions, a `useState`, and three `useNoticeExpiry` timers.

One `useStatusStore` holding both slots removes the merge, the local state, two
of the three timers and fourteen subscriptions, and gives the next feature
store both surfaces for free.

## The store

```ts
interface StatusState {
  message: string | null; // the popover
  notice: string | null; // the content line
  report: (cause: unknown) => void; // String(cause); one slot, last wins
  notify: (text: string) => void;
  dismiss: () => void;
  dismissNotice: () => void;
}
```

`App` subscribes to `message` and `notice` as two primitive selectors rather
than one object, and keeps one `useNoticeExpiry(notice, dismissNotice,
NOTICE_MS)`. `NOTICE_MS` moves here from `playlists/store.ts:40`.

## Decided

- **The catches call `report`.** Not a wrapper around `ipc`: sixty-odd free
  functions to wrap, and it cannot tell a failure worth a popover from one
  worth nothing. The deliberate silences are `loadColumns` (library),
  `loadSections` and `toggleSection` (playlists), `refreshUndo` (editor) and
  `getAppInfo` (`App`) - they keep their bare `catch` and its comment.
  `player/store.ts`'s `run` helper stays as the one wrapper, reporting instead
  of setting.
- **The updater keeps its own `error`.** It is diagnostic state behind
  `status: "failed"`, deliberately unshown; routing it through `report` would
  pop a message every time a check runs offline.
- **last.fm keeps its own error.** `LastfmSettings` draws it inside the dialog
  it belongs to, not in the popover, and it holds two written messages rather
  than a stringified cause.
- **One slot, last wins, dismiss clears it.** What five overlapping fields
  already amount to; uncovering the next one would read as the message refusing
  to go away.
- **`refresh` stops reading its own error field.** `library/store.ts:343` uses
  `state.error === null` to tell "the drilled-in group is gone" from "the query
  failed"; a local flag set in the catch replaces it. It is the only read of
  any of these fields outside `App`.
- **`report` takes `unknown`, not a cause.** `onPlayerError`
  (`player/store.ts:109`) hands over a string with no `catch` around it.
- Library page loads report from inside a `set((state) => …)` updater
  (`store.ts:627`); the cross-store call moves out of it.

## To decide

- **Whether an operation still pre-clears.** `refresh`, `playlists.load`,
  `editor.open`, `addFolder` and `rescan` set `error: null` as they start. On
  one slot that wipes whatever any store reported - which dismissing already
  does today, but on a keypress rather than on a click. The alternative is that
  only `report` and `dismiss` write the slot, and a stale message outlives a
  successful retry until it is dismissed.

## Order

The store and its tests; then one feature store per commit, its own tests
moving to `useStatusStore.getState().message` (about fifteen assertions across
five files); then `App`, which is where the fields stop being read and can be
deleted. `App.test.tsx:151,156` reset `notice` and `error` per store - the new
store needs a reset of its own in that setup.
