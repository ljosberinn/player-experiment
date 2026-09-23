# 128 — Settings' buttons are drawn by the app

Reading of "dark mode buttons under settings": the buttons inside the Settings
panes have no style of their own, and in dark mode the engine draws them.

These are bare `<button>`s with no class:

- Library: Choose… / Change…
  ([LibraryFolderSettings.tsx:108](../../../src/features/library/LibraryFolderSettings.tsx#L108))
  and Remove on each watched folder
  ([WatchFolderSettings.tsx:130](../../../src/features/library/WatchFolderSettings.tsx#L130)).
- Online: Disconnect, Cancel, Connect, Import / Resume, and Re-import from
  Scratch ([LastfmSettings.tsx:51](../../../src/features/lastfm/LastfmSettings.tsx#L51)).
- About: Show Log File
  ([SettingsDialog.tsx:208](../../../src/features/shell/SettingsDialog.tsx#L208)).

`.modal button` used to draw them (a `--field` fill, a `--chrome-border`
edge, `--text`, `font: inherit`). #242 removed it with the `.modal` block and
moved only the footer buttons onto `<Button>`
([113](../done/113-dialog-chrome.md)). Nothing replaced it. The panes now get
the user agent's button: `color-scheme: dark` makes that a mid-grey
`ButtonFace` slab with rounded corners in the system face, which is off the
token set and glaring on `--chrome`. On light the same default is close
enough to the chrome that it passes unnoticed. Connect's `className="primary"`
is orphaned, because `.button.primary` needs `.button`.

Move each one onto `<Button>`
([Button.tsx](../../../src/components/primitives/Button.tsx)) as
`secondary`. The zoom stepper keeps `.statusbar-zoom button`, which is drawn.

**Decision:** Connect as `primary` or `secondary`. Done in the footer is
already the pane's primary, and the sheet allows one per surface.

While here: `.settings-rail .settings-tab`
([app.css:2019](../../../src/styles/app.css#L2019)) is a Base UI `<button>`
that states no `font: inherit`. The category rail is in the system face on both
grounds.

Guard: `SettingsDialog.test.tsx` asserts that every `button` in each pane
carries a class. jsdom has no stylesheet, so a class is all it can check.
`LastfmSettings` and the folder tests find buttons by role and name, so they
do not move.

## Verification

- Each Settings pane on dark and on light: every button is the sheet's
  secondary (or primary) and is set in Archivo.
- Connect is disabled on a key-less build and reads as a dimmed secondary.
- The rail's categories are in Archivo.
- Screenshots of the Library, Online and About panes on both grounds.
