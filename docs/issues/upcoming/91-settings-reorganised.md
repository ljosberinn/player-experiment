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

The dialog takes a fixed size the way [89](../done/89-the-lookup-window-stops-resizing.md)
gives the lookup one, with the rail and the action row fixed and the pane the
only thing that scrolls. Do that phase first, or after it, but share the
mechanism rather than writing a second one.

**About is one row today**, and the two things next to it in the app are the
version in the status bar and `Source Code on GitHub` in the Help menu. Moving
either is not required and would want its own reasoning; the category name is
what leaves room for it.

**last.fm is reachable twice.** The Account menu offers `Connect to last.fm…`,
which opens this dialog, and `Disconnect from last.fm`, which acts. A dialog
with a category for it makes that duplication a decision rather than an
accident: recommendation is that the menu keeps the connected username and
Disconnect and routes Connect here, as it already does, and that the
reorganisation says so out loud rather than leaving two answers.

## The design source is the gate

`docs/knowledge/design.md`: where the app and the design disagree about how
something *looks*, the design wins — and the Claude Design project holds a
settings dialog. A reorganisation here is an amendment there.

**Re-fetch it before building and amend it after.** `DesignSync` could not be
reached while this was written; it needs `/design-login` from an interactive
session first. The Discord screenshot is where the ask starts, not where the
design ends.

`design.md` takes the new layout when it lands, and `SettingsDialog`'s doc
comment stops being a list of arrivals.

Testing: `SettingsDialog.test.tsx` — each category renders its own controls and
none of the others, and the rail moves the selection. Four e2e specs reach this
dialog through `Edit ▸ Settings…` and will need their routes updated:
`library-folder`, `dynamic-background`, `menus`, `row-menu`. Worth a `capture`
per category — it is the second most-looked-at dialog in the app and there is
no shot of it today.
