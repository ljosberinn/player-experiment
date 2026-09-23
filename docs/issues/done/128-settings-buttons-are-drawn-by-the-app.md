# 128 — Settings' buttons are drawn by the app

Reading of "dark mode buttons under settings": the buttons inside the Settings
panes have no style of their own, and in dark mode the engine draws them.

These were bare `<button>`s with no class:

- Library: Choose… / Change…
  ([LibraryFolderSettings.tsx](../../../src/features/library/LibraryFolderSettings.tsx))
  and Remove on each watched folder
  ([WatchFolderSettings.tsx](../../../src/features/library/WatchFolderSettings.tsx)).
- Online: Disconnect, Cancel, Connect, Import / Resume, and Re-import from
  Scratch ([LastfmSettings.tsx](../../../src/features/lastfm/LastfmSettings.tsx)).
- About: Show Log File
  ([SettingsDialog.tsx](../../../src/features/shell/SettingsDialog.tsx)).

`.modal button` used to draw them. #242 removed it with the `.modal` block and
moved only the footer buttons onto `<Button>`
([113](113-dialog-chrome.md)). The panes got the user agent's button: on
`color-scheme: dark` a mid-grey `ButtonFace` slab in the system face. Connect's
`className="primary"` was orphaned, because `.button.primary` needs `.button`.

Each one is now a `<Button>`
([Button.tsx](../../../src/components/primitives/Button.tsx)) of kind
`secondary`, Connect included: Done in the footer is the dialog's one primary.
`Button` forwards `aria-label` and `aria-describedby`, which Remove and
Choose… carry. The zoom stepper keeps `.statusbar-zoom button`.

`.settings-rail .settings-tab` states `font: inherit`, so the rail is in
Archivo rather than the system face.

Guard: `SettingsDialog.test.tsx` asserts every `button` in each pane, bar the
zoom stepper, carries a class, and none names a kind without `.button`. It
seeds a watched folder and the last.fm states so every button is rendered.
`drawn-controls.test.ts` photographs the Library, Online and About panes on
both grounds.

## Verification

- Each Settings pane on dark and on light: every button is the sheet's
  secondary and is set in Archivo.
- Connect is disabled on a key-less build and reads as a dimmed secondary.
- The rail's categories are in Archivo.
