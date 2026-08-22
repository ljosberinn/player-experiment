# 34 — The menu bar, and the toolbar that is gone

Merged in #53, together with [41](41-screenshot-viewport.md).

A 36px title bar: the Apex mark, the menus, the version, the window buttons —
Base UI `menubar` and `menu`, so roving focus, typeahead, Escape and submenu
timing come for free. **The library toolbar and `TabBar` were deleted here**, with
their tests.

- **File** — Add Folder…, Rescan (F5), and Remove *n* Missing Songs…, enabled only
  when `stats.missing > 0`. The mockup has nowhere for that because a mockup has no
  missing files; next to the scan that discovers them is where it belongs.
- **Edit** — the song row's own menu, acting on the current selection, so there is
  exactly one definition of what can be done to songs. `rowMenuItems()` was
  already pure, so the labels ("Edit 3 Songs") come out right for free. Plus Undo
  Tag Edit and Settings….
- **Export** — its own top-level menu. `exportChoice()` already computed the
  selection-beats-playlist-beats-library rule; it moved from the button into the
  menu.
- **Account** — present, empty, disabled. Shipping it now means the shell does not
  change shape when last.fm arrives.
- **Help** — a repository link, which needed `tauri-plugin-opener` and
  `opener:allow-open-url` **scoped to `https://github.com/ljosberinn/*`**. A
  local-only app should be able to open exactly the links it means to.
- F5 joined the existing shortcut layer rather than a bare listener, so it is
  testable and cannot fire while a text field has focus.
