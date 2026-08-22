# 22 — Media keys that work without focus

Merged in #32, answering *"pressing the play/pause hotkey without app focus
doesn't trigger it"* — correct for a window-scoped `keydown` listener, wrong for
a music player. The window bindings are untouched; this is a second, narrower
path for the four keys whose whole purpose is to work while the app is behind
something else.

- **`tauri-plugin-global-shortcut` grants nothing by default** — its `default`
  permission set is empty on purpose, so `global-shortcut:default` looks like a
  grant and is none. `allow-register` and `allow-unregister` are listed
  explicitly.
- **Not Space, and not the arrows.** A global shortcut is exclusive: registering
  Space system-wide would break the space bar in every other application. A test
  asserts the list never grows into them.
- Registered one key at a time — the array form is all-or-nothing, so one key
  held by another player would cost the other three.
- A failed registration is not an error and not a banner. Only keys actually
  claimed are released; releasing one never held could take it from whoever does.
- Unregistering also covers unmount-during-registration.
- **The capability guard caught itself being useless**: the two new rows were
  written with a here-doc that turned `\b` into a literal backspace, so the regex
  matched nothing and the test passed vacuously. Found by deleting each
  permission and checking the guard went red — which it had not. `unregister` is
  listed before `register`, anchored on `await `, because the names overlap.
- Whether the OS delivers a key to an unfocused window cannot be tested in CI or
  jsdom. Registration, mapping, failure path and lifecycle are covered; delivery
  is a manual check.
