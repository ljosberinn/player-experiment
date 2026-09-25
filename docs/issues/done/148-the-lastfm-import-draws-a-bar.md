# 148 — The last.fm import draws a bar

Settings › last.fm read "Importing n of n scrobbles…" as text. It draws a
`TaskLine` during a run, as the editor's `WriteLine` does; the status bar's
`TaskProgress` stays text.

No progress, or `total === 0`, reads "Importing…" with an empty rail.

## Verification

- Settings › last.fm: the bar steps page by page during an import.
- The status bar and the pane agree on the count.
