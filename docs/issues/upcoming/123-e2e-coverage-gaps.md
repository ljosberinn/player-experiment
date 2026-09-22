# 123 — What no e2e spec drives

An inventory, not a feature. Twenty-four spec files cover the app; what follows
is what a user can do in the running window that none of them does. Each item
is a route that exists, a reason the gap matters, and how to drive it. What a
driver cannot reach is at the bottom, for `testing.md`'s *Uncovered on purpose*
list rather than for a spec.

Every group below is independent of the others except where said, but all of
them add a line to `wdio.conf.ts`'s ordered `specs` array, so parallel
worktrees collide on that one line. Land them in sequence, or take the conflict.

## Playback past the first note

`smoke.test.ts:88` asserts Previous, Play and Next exist and are enabled
against an *empty* library. Nothing ever presses Next with a queue behind it.
No spec has seen the queue advance, by hand or on its own, seen a pause, or
seen the playhead move — `library.test.ts:293` starts a track and reads the
row marker, and that is the whole of it.

`player_snapshot` carries `status`, `track`, `queue_index`, `queue_len` and
`position_ms` ([model.rs:839](../../../src-tauri/src/model.rs#L839)), so all of
this is assertable against the player rather than against the DOM that draws
it. Fixture tracks are 44–236 MPEG frames, 1.1s to 6.2s
([fixtures.ts:223](../../../e2e/fixtures.ts#L223)), and `SilentSink` advances
position on a wall clock, so waiting a track out costs a second.

- Next and Previous move `queue_index`, and `.now-playing-title` with it.
- A track ends and the next one starts unasked. The one assertion that needs
  the clock, and the one that would catch a queue that advances only when
  pressed.
- Repeat-one replays the same row and leaves `queue_index` alone.
  `transport.test.ts:105` proves the flag round-trips to the player; nothing
  proves it changes what happens next.
- Play becomes Pause — `status`, and the button's `aria-label` with it.
- The scrubber moves `position_ms`. It is an `<input type="range">`, so focus it
  and use `browser.keys`; a pointer drag along a rail is the flake `row-drag`
  already pays for.

New `playback.test.ts`, after `library.test.ts`. `transport.test.ts` runs
before the library is seeded, deliberately, and none of this works without
songs.

## The keyboard, which is F5

`menus.test.ts:154` presses F5. That is the only key in the suite that is not
Escape, Enter or Backspace. Every other binding is covered from a dispatched
keydown down, in jsdom, which cannot see either half of what matters here: that
the handler is bound at the window at all, and that `isTypingTarget` stands it
down inside the search box.

Bindings with no spec: Space (toggle), ←/→ (seek), Alt+←/→ and the mouse's side
buttons (history), Ctrl+plus / Ctrl+minus (zoom), Escape (clear selection),
Delete (open the removal confirm). `navigation-history.test.ts` drives the two
buttons and never the chord.

Two per binding, the second being the one worth having: the key does its thing,
and the same key typed into `input[aria-label='Search Library']` does not. The
side buttons are a `mouseup` with `button` 3 or 4, dispatched the way
`row-menu.test.ts` dispatches `contextmenu`.

New `shortcuts.test.ts`. **Stacked behind [121](121-arrows-move-the-selection.md)**,
which moves ↑/↓ from volume to the selection — writing it first means rewriting
two assertions.

## Destructive confirmations, past Cancel

`row-menu.test.ts:222` opens the library-removal confirm and takes Cancel.
Nothing in the suite has ever confirmed one, so no spec has seen a row leave
the library, seen the notice that says how many
([App.tsx](../../../src/App.tsx) `removeFromLibrary`), or seen the count in
`.statusbar-summary` fall.

Three dialogs, one chain, and the chain is why it is one spec:

1. Remove *n* songs from Library → Remove → the row is gone, the notice says
   `Removed 1 song from your library.`, the summary drops by one.
2. `File ▸ Forget n Removed Songs…` only appears once something has been
   removed ([menus.ts:110](../../../src/features/shell/menus.ts#L110)), so it is
   reachable only after step 1. Nothing covers it today, including the fact
   that the entry is absent before then.
3. `File ▸ Remove n Missing Songs…` needs `stats.missing > 0`. Reachable by
   deleting a fixture file off disk and rescanning through the File menu, the
   way `logfile.test.ts:61` rescans.

New `removals.test.ts`, and it must run **last** among the specs that count
rows — it is the only one that takes songs out of the shared library.
`virtualization.test.ts` and `statistics.test.ts` both depend on what the scan
found.

## The playlist sidebar, minus the drag

`row-drag.test.ts` creates a playlist by dropping rows on the dropzone and
reorders inside it, and its `after` hook deletes it through the row menu
without asserting anything about the deletion. Everything else the sidebar
offers is untouched:

- `button[aria-label='New playlist']` — an empty static playlist, which is also
  the only route to the third empty state (`<name> is empty. Drag songs from
  your library onto it in the sidebar.`). The other two are covered by
  `smoke.test.ts:113`.
- Rename: double-click a `button.sidebar-item` opens `input.sidebar-rename`;
  commit renames, Escape does not. `row-drag.test.ts:166` sees the field only
  because a fresh drop opens it.
- Delete, as its own assertion — the confirm names the playlist
  (`Delete "<name>"?`) and the row goes.
- The row menu's `Play` on a playlist, and its `disabled` state at zero tracks.
- `Add to Playlist ▸ <name>` in the *row* menu
  ([rowMenu.ts:153](../../../src/features/library/rowMenu.ts#L153)) — the
  non-drag route into a playlist, and the only one a keyboard user has.
- `Remove from Playlist`, which is offered on static playlists only.

Extend `row-drag.test.ts`? No — rename that file's subject or the sidebar work
inherits its pointer flake. New `playlists.test.ts` after it.

## The column layout

`ColumnHeader.tsx` carries four interactions and the suite drives none:
reorder by dragging a header, resize by the divider
(`[data-testid='resize-<id>']`), double-click a divider to fit the column, and
a context menu on the header row (`ContextMenu label="Columns"`) that toggles
visibility and offers `Reset Columns`. `library.test.ts:491` asserts a width,
but the width a *drill-in* produces — nothing touches a width a user set.

What only the engine can answer: that a dragged header lands where the drop
indicator said, that `MIN_COLUMN_WIDTH` clamps a drag rather than the store,
and that a hidden column's cells go with its header.

Pointer-driven, so it belongs with `row-drag` and `row-menu` in the group that
flakes on the Windows runner — its own file, `columns.test.ts`, so a flake there
is legible. The menu half needs no pointer beyond the dispatched `contextmenu`
and is worth keeping in the same file regardless.

## The statistics filter bar

`statistics.test.ts` drills into an artist and a genre and never touches the bar
above them. `StatsFilterBar` has five drawn selects — Range, Owned, Loved,
Scope, Genre — plus two date fields, and each one re-runs every panel's query
underneath it. Uncovered entirely.

Worth at most three tests, because the arithmetic is asserted in Rust: Range
narrows and the tiles change, Scope set to a playlist narrows to it, and a
custom range shows the two date fields it hides at every other value.

Driving a drawn select is `appearance.test.ts:105` — click the trigger, click
`[role='option']=<label>`, then wait for `[role='listbox']` to stop being
displayed, because Base UI animates the popup out over whatever is under it.
That helper is copied in two specs now and would be three; **extract it to
`e2e/select.ts`** as part of this. `src/test/select.ts` is the jsdom
equivalent and does not apply.

## Settings, the panes nothing presses

`menus.test.ts:95` visits all four category tabs and reads one label from each.
Theme (`appearance.test.ts:683`), the dynamic-background checkbox
(`dynamic-background.test.ts:273`) and the library-folder section
(`library-folder.test.ts`) are driven. Not driven:

- Interface Zoom, in either place it lives — the Settings row or
  `.statusbar-zoom` in the footer. Nothing asserts that the stepper scales
  anything, that `.statusbar-zoom-value` follows, that the buttons disable at
  `MIN_ZOOM`/`MAX_ZOOM`, or that the factor survives a reload. **Caution:**
  `viewport.ts:130` sets webview zoom directly *because* the app's store
  persists, so a zoom spec has to put the preference back or every screenshot
  after it is at the wrong size.
- `#unattended-lookup` on the Online pane — a checkbox writing a backend
  setting, same shape as the dynamic-background one that is covered.
- Removing a watch folder through `WatchFolderSettings`.
  `library-folder.test.ts:51` calls `remove_watch_folder` directly in its
  teardown, so the button that does it has never been pressed.

Extend `library-folder.test.ts` for the folder row; new `zoom.test.ts` for the
stepper, because of the restore discipline above.

## Smart playlist filters

`smart-playlists.test.ts:120` builds a playlist with **no rules at all** and a
cutoff, and says why: a text rule is a combobox portalled over what comes next,
and a Year rule took `setValue` and silently matched nothing. So no spec has
ever built a condition — no field, no operator, no value, no any/all group, no
nesting. `SmartPlaylistEditor.test.tsx` covers the markup in jsdom.

This is the largest single gap and the reason it stayed open is real. Narrow it
rather than closing it: one condition on a numeric field, built through the
editor, saved, and the membership asserted by the row count. Then reopen the
editor and assert the operator and value came back. A `.dialog-field input`
that reports the right value and builds a playlist matching nothing is the
exact failure that shipped here before, so the assertion has to be on the rows.

The combobox behind a text field is its own question and stays out of scope.

## The tag editor's save

`tag-editor.test.ts` covers the artwork square, the drop and the refusal, and
its `closeEditor` helper is Cancel — *"the only exit that writes nothing"*
(`tag-editor.test.ts:142`). Nothing drives the save. `tags://progress` reaches
the app in `task-progress.test.ts` as an emitted payload, not as a real write.

A single-track save of one field, then reopen the editor and read it back, is
enough — `tests/tagwrite.rs` owns the batch and the file format. What it adds
over the Rust test is that the dialog's state reaches the command at all. The
mixed-value bulk fields stay in `TagEditor.test.tsx`.

`e2e/.tmp` fixtures are rewritten per run, so a write is safe, but this spec
must run after every spec that reads a fixture's tags — `library.test.ts`
asserts what the scanner read.

## One assertion that cannot fail

`smoke.test.ts:110` asserts `.content-error` is absent after a play command
against an empty queue. That class only ever renders inside `TagEditor` and
`CrashNotice`, neither of which is mounted at that point, so it is vacuous. A
player error surfaces in `.error-popup` today
([ErrorPopover.tsx:50](../../../src/components/ui/ErrorPopover.tsx#L50)).
One-line fix, and it belongs in whichever of the above lands first.

## Not reachable from a driver

For `testing.md`'s *Uncovered on purpose* list, not for a spec:

- **Export.** `menus.test.ts:104` asserts both entries and the disabled one.
  Running one goes through `save()`, an OS file dialog, which is the same wall
  as the folder picker — and the playlist and row menus' `Export…` with it.
- **`Show in Explorer`** and **`Show Log File`**, which hand a path to the
  opener plugin and a file manager. Listable, not followable, the way
  `Help ▸ Source Code on GitHub` is (`menus.test.ts:141`).
- **Love / Unlove.** Needs a last.fm key, which CI does not have by design.
  `row-menu.test.ts:246` asserts its absence, which is the covered half.
- **The update button.** `.statusbar-update` appears only when the updater has
  a real release staged.
- **Window geometry across a restart.** A spec cannot restart the process it is
  driving; `browser.refresh()` reloads the webview inside the same window.
- **Throwing `#organize-library` on.** It moves the library on disk. The mover
  has its own tests over a temp tree (`library folder`, `testing.md`), and a
  spec that threw it would be rearranging the fixtures every spec after it
  depends on.

## Docs

`testing.md`'s e2e row and its *Uncovered on purpose* list, once per group that
lands. The list grows by the section above; the row grows by what each spec
adds.
