# 152 — A home for the view summary

The summary ("n songs, x hours, size", from `viewSummary`) leaves the status bar
for the top of the content pane, and the status bar goes.

Departs from the design, which draws a bottom strip with the summary centred,
knowingly.

## Where the summary goes

`ViewSummaryText` subscribes to its own counts. Draws nothing when
`viewSummary` returns `""`: Statistics, and any empty view, whose empty state
already says so in a sentence.

- **Releases, Artists, Genres:** beside the heading, in `.view-heading-title`,
  baseline-aligned 12px apart.
- **Drill-in:** right end of the breadcrumb row, `.browse-back-row`.
- **Songs, playlists, search:** `.view-summary-line` over the table, inset 15px
  like the breadcrumb. Songs still has no heading.

## The status bar goes

- Window order: app bar → body → player bar.
- The zoom stepper leaves the window; Settings > Appearance and Ctrl+plus /
  minus / 0 remain. `.statusbar-zoom*` → `.zoom-stepper*`.
- The update offer moves to the app bar after the version: `UpdateButton` in
  AppBar's `update` slot, `.appbar-update`.

## Tests

- e2e: readiness waits on `.appbar`; `library` and `smoke` read `.view-summary`;
  the zoom shortcuts read `load_zoom`; band order drops the status bar.
- Stories: `ViewSummaryText` in its three placements, `UpdateButton` on the app bar.
