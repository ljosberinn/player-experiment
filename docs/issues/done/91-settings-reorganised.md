# 91 — Settings, reorganised

Eight controls in one 420px column, in the order they arrived: Interface Zoom,
Colour From Album Art, the Library Folder section, the Music Folders section,
Look Up Releases Online, the last.fm section, Activity Log. `SettingsDialog`'s
own doc comment is the record — phase 39, phase 10b, issue 71, issue 86, issue
83c, each placement argued against its neighbours. Every one of them is
defensible and the whole has no shape.

It does not fit either. Measured at a 1440×900 window, where 86vh is 695px, the
content is 813px with one watch folder and 916px with eight. `.modal` is the
scroller and `.modal-actions` is an ordinary flex child inside it, so **Done is
below the fold from the first launch**.

## A rail and a pane

The reference the ask names is Discord's settings: categories down the left, one
scrolling pane on the right, a heading per group. Take the structure, not the
chrome — this is a dialog rather than a window, and the app's own tokens,
hairlines and translucent chrome carry over unchanged.

Four groups is what there is to hold:

- **Appearance** — Interface Zoom, Colour From Album Art
- **Library** — Library Folder, Organise My Library, Music Folders, Check For
  Changes
- **Online** — Look Up Releases Online, last.fm
- **About** — Activity Log

The dialog takes a fixed size through [89](89-the-lookup-window-stops-resizing.md)'s
`.modal.paned`, with the rail and the action row fixed and the pane the only
thing that scrolls. `Tabs.List` has to sit inside `Tabs.Root`, so the popup
renders as the root: rail and panel are then both its children, and the panel
is the `.modal-body`. `.settings-folders` loses its 132px cap: inside a paned dialog it is the second
scroller 89 removed from the lookup.

**About is one row today**, and the two things next to it in the app are the
version in the status bar and `Source Code on GitHub` in the Help menu. Moving
either is not required and would want its own reasoning; the category name is
what leaves room for it.

**last.fm is reachable twice.** The Account menu offers `Connect to last.fm…`,
which opens this dialog, and `Disconnect from last.fm`, which acts. A dialog
with a category for it makes that duplication a decision rather than an
accident: recommendation is that the menu keeps the connected username and
Disconnect and routes Connect here, as it already does, and that the
reorganisation says so out loud rather than leaving two answers. **Connect opens
on Online**, not on Appearance — the dialog is remounted per open and would
otherwise land a category away from the one thing it was opened for.

## The design source is the gate

`docs/knowledge/design.md`: where the app and the design disagree about how
something *looks*, the design wins — and the Claude Design project holds a
settings dialog. A reorganisation here is an amendment there.

**Re-fetch it before merging and amend it after.** `DesignSync` could not be
reached when this was written nor when it was built; it needs `/design-login`
from an interactive session, and writing to the project needs `/design-sync`,
which only the user starts. Built on the app's tokens meanwhile — rail items
wear `.sidebar-item`'s look — so the check against the design is a pre-merge
item, not a build step. The Discord screenshot is where the ask starts, not
where the design ends.

`design.md` takes the new layout when it lands, and `SettingsDialog`'s doc
comment stops being a list of arrivals.

Testing: `SettingsDialog.test.tsx` — each category renders its own controls and
none of the others, and the rail moves the selection. Four e2e specs open this
dialog through `Edit ▸ Settings…`: `library-folder`, `dynamic-background`,
`lastfm-import` and `menus` (`row-menu` only reads the menu);
`library-folder` and `lastfm-import` reach past Appearance and need a rail
click. `menus`' one `settings` shot becomes a `capture` per category.
