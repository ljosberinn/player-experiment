# 146c — Stories for the window chrome

These components render from props alone. `RowStatusCell` is in this issue
because it has no store either. This issue is independent of the others in the
series and gets its own worktree.

Each story file sits beside its component. A sheet draws every state at once,
except where a popup can only be shown one at a time.

| Story file | Title | Draws | States |
| --- | --- | --- | --- |
| `components/ui/AppBar.stories.tsx` | `UI/AppBar` | `AppBar` holding `MenuBar` and `SearchBox` | with a version, `version={null}` |
| `components/ui/Sidebar.stories.tsx` | `UI/Sidebar` | `Sidebar`, `SidebarSection`, with `LibraryNav` as LIBRARY | a section that does not fold, expanded with `actions`, collapsed with `actions`, overflowing without |
| `components/ui/ContextMenu.stories.tsx` | `UI/ContextMenu` | `ContextMenu` | item, separator, `shortcut`, submenus, opened by a `play` right-click; disabled with `hint` and an empty submenu on the second region |
| `components/ui/MenuBar.stories.tsx` | `UI/MenuBar` | `MenuBar` | Edit opened by `play` |
| `components/ui/ConfirmDialog.stories.tsx` | `UI/ConfirmDialog` | `ConfirmDialog`, one story each | default label, `confirmLabel`, long body |
| `components/ui/ErrorPopover.stories.tsx` | `UI/ErrorPopover` | `ErrorPopover` anchored to `NowPlaying` in a `.player-bar` | short, long; dismissing gives `null`, a button raises it again |
| `components/ui/PlayerControls.stories.tsx` | `UI/Player controls` | `Transport`, `Scrubber`, `VolumeControl`, `RepeatButton` | paused, playing; scrubber at start, middle, end, no duration; volume 0, muted, full; repeat off, on |
| `features/library/RowStatusCell.stories.tsx` | `Features/Library/RowStatusCell` | `RowStatusCell` in `.song-table` rows | playing, missing, none, `track={null}`, playing and missing on a selected row |

- Every control is live, with `useState` in the story.
- Menus come from `rowItems()` and `MENUS` in `.storybook/fixtures.ts`, built
  by `rowMenuItems` and `menus()`.

## Verification

- `npm run storybook`: every state in the table renders on both grounds, and
  the popups open over the canvas.
