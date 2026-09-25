# 146c — Stories for the window chrome

These components render from props alone. `RowStatusCell` is in this issue
because it has no store either. This issue is independent of the others in the
series and gets its own worktree. Titles go under `UI/`.

| Story file | Draws | States |
| --- | --- | --- |
| `ui/AppBar.stories.tsx` | `AppBar` | with a version, and with `version={null}` |
| `ui/Sidebar.stories.tsx` | `Sidebar`, `SidebarSection` | expanded, collapsed, with `actions`, overflowing |
| `ui/ContextMenu.stories.tsx` | `ContextMenu` | item, separator, `shortcut`, disabled with `hint`, `submenu`; opened by a `play` right-click |
| `ui/MenuBar.stories.tsx` | `MenuBar` | a `menus` model like the one `AppMenus` builds, with one menu opened by `play` |
| `ui/ConfirmDialog.stories.tsx` | `ConfirmDialog` | default label, a custom `confirmLabel`, a long body |
| `ui/ErrorPopover.stories.tsx` | `ErrorPopover` | a message against an anchor, a long message, `null` |
| `ui/PlayerControls.stories.tsx` | `Transport`, `Scrubber`, `VolumeControl`, `RepeatButton` | playing and paused; scrubber at start, middle and end, and with no duration; volume 0, muted, full; repeat on and off |
| `features/library/RowStatusCell.stories.tsx` | `RowStatusCell` | playing, missing, none, `track={null}`, drawn inside a `<table>` |

- Keep the controls live, with `useState` in the story, as
  `Select.stories.tsx` does.
- Point the `ErrorPopover` anchor at a real element the story renders.
- `RowStatusCell` needs a `Track`. Until 146a lands, give it a literal typed
  `Track` in the story file, and swap it for `track()` from
  `.storybook/fixtures.ts` in whichever issue lands second.

## Verification

- `npm run storybook`: every state in the table renders on both grounds, and
  the popups open over the canvas.
