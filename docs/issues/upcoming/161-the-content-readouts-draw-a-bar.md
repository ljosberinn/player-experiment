# 161 — The content readouts draw a bar

Above the content pane, three readouts are text only (`.scan-progress`):

- `ScanBar` — "Scanning n of n"
- `TaskProgress` — "Exporting n of n", "Importing scrobbles n of n"

Draw each as a `TaskLine`, as `WriteLine` and the Settings import do. A total of
zero reads the verb alone over an empty rail.

## Verification

- A rescan, an export and a last.fm import each step a bar above the content.
- Nothing is drawn, and no space is taken, while none runs.
