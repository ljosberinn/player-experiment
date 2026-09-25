# 156 — The last.fm import draws a bar

Settings › last.fm reads "Importing n of n scrobbles…" as text
(`importLine` in `LastfmSettings.tsx`). Draw it as a `TaskLine` with a
`ProgressBar`, as the status bar's `TaskProgress` already does for the same
`importProgress`.

No progress, or `total === 0`, reads "Importing…" with an empty rail.

## Verification

- Settings › last.fm: the bar steps page by page during an import.
- The status bar and the pane agree.
