# 185 — Ctrl+K opens a command palette

Everything the menu bar and the shortcuts do, typed.

## Shape

- `components/ui/CommandPalette.tsx`: Base UI `Autocomplete` (`inline`, `open`,
  `autoHighlight="always"`, `keepHighlight`) inside the `Dialog` primitive
  (`paned`, variant `palette`) — the recipe in
  `@base-ui/react/docs/react/components/autocomplete.md`, § Command palette. No
  new dependency. Filters word by word, in any order.
- It takes groups of `MenuItem`, the vocabulary `menus()` and `rowMenuItems`
  already build in. `disabled`, `hint` and `shortcut` render as a menu renders
  them. Submenus flatten to `Parent › Child` (`Add to Playlist › Mix`), the
  parent's ellipsis dropped; a greyed parent greys its children.
- `features/shell/commands.ts`, pure: state in, `{ group, items: MenuItem[] }[]`
  out.
- The wiring `AppMenus` did around `menus()` is `useMenus()`, which both use, so
  the palette and the bar cannot drift.
- `features/shell/AppPalette.tsx` holds the open flag and Ctrl+K, so opening
  re-renders nothing around it. Closed, it subscribes to nothing.
- No design exists for it: `Dialog` chrome, `ContextMenu` item rows, both
  grounds.

## Groups

| Group | Entries |
| --- | --- |
| File, Edit, Export, Account, Help | `menus()` as is. A disabled menu is left out. |
| Playback | Play/Pause (greyed with nothing queued), Next, Previous, Stop (only while loaded), Mute, Repeat One, labelled for what the press does now |
| View | Zoom In, Zoom Out, Actual Size (greyed at their limit), Light, Dark, System Theme (the current one greyed); `Settings › <category>` |
| Library | New Playlist, New Smart Playlist… |

`shortcut` only where a binding exists (Space, Ctrl+Plus, Ctrl+I…).

## Keys

- Ctrl+K toggles. Claimed from a text field and always `preventDefault`ed, as
  Ctrl+F is. Does not open while a `.dialog` is up.
- Enter or a click closes, then runs the highlighted entry; Escape closes. Focus
  returns where it was. A greyed entry is reachable and does nothing, as in a
  menu.

## Tests

- `commands`: which entries appear, greyed, flattened.
- Component: typing filters; Enter runs and closes; a greyed entry does not
  run; Escape restores focus.
- `App`: Ctrl+K from the search box; not under a dialog; Edit's entries follow
  the selection; a dialog an entry opens gets the focus. Opening re-renders
  neither `App` nor the table.
- `e2e/specs/shortcuts.test.ts`: Ctrl+K opens from the search box; not under a
  dialog; screenshots of the open palette on both grounds.

## Docs

README Keyboard, `frontend.md`, `design.md` § What the mockup is not.

## Verification

- Ctrl+K in the built app opens the palette, not anything of WebView2's.
- One row selected: Edit's entries act on it. None: they are absent.
- `zoom` Enter zooms. Export Selection with nothing selected is greyed.
- Both grounds read as the app's own dialog.
