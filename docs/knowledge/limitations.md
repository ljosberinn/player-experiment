# Accepted limitations

Known, decided, and not scheduled. Anything with work attached lives in
[issues/upcoming/](../issues/upcoming/) instead.

- **No folder drag-and-drop ingest.** `dragDropEnabled` must stay `false` for
  in-app dragging to work at all, and Tauri v2 cannot toggle it at runtime.
  Adding music is a folder picker. Settled by the user: the daily gesture beats
  the occasional one. Revisit only if Tauri gains a runtime toggle.
- **No crash reporting off the machine.** A local panic log covers the failure
  class; a network reporter contradicts the product.
- **Installers are unsigned.** SmartScreen warns on first run of each version.
- **mp3 only.** The schema and `lofty` both allow flac/m4a later with no
  migration.
- **No gapless playback.** The join is down to roughly 10ms, not to nothing:
  sample accuracy needs the next decoder appended to the same `rodio::Player`,
  which costs the one-`Player`-per-track design the engine relies on.
- **No shuffle, and no repeat-all.** Repeat is one song, on or off. Deliberate.
- **A playlist cannot hold the same track twice**, by schema. iTunes allows it;
  reporting "added 6 of 10" is the better answer.
- **`covers` is never pruned.** Undo depends on old artwork still being there.
- **The undo journal is unbounded** — one row per track per edit, forever.
- **Dragging is mouse-only**, but nothing behind it is any more: the Menu key
  opens the row menu on the selection, Alt+Arrow nudges it within a playlist,
  and Delete removes from one. What has no keyboard route is the gesture, not
  the actions.
- **The frameless window is not covered end to end** — the e2e build pins
  `decorations: true` or the embedded driver never sees the webview.
- **e2e cannot perform an OS drag**, and no test asserts that sound came out or
  that the OS delivers a media key to an unfocused window.
- **`npm audit` reports a dev-only advisory** in `serialize-javascript` via the
  `@wdio/*` chain. Production dependencies are clean; not force-fixing.
- **Statistics is shipped dimmed and inert**, as the design draws it.
- **The last.fm session key is stored unencrypted**, in one `settings` row,
  labelled as such in the code and in the Settings pane. Decided in
  [plans/lastfm.md](../plans/lastfm.md): DPAPI would cost the crate's
  `unsafe_code = "forbid"` permanently, the credential is a revocable
  scrobbling token rather than a password, and encryption under a constant
  compiled into the binary is worth nothing while looking like protection.
- **Disconnecting from last.fm is local only.** The API has no method to revoke
  a session key, so the app forgets it and the pane says where to revoke it
  properly.
