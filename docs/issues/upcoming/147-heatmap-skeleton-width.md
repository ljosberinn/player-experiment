# 147 — The heatmap's loading grid shrinks to its labels

While `WeekClock` loads, the skeleton grid is drawn a few pixels per cell wide,
centred in the panel, with the hour labels run together. The loaded grid fills
the panel's width.

`.chart-loading .chart-plot` centres its child with flex (`app.css`), which is
right for `.chart-skeleton` (`width: 100%`) but shrinks `.heatmap`, which sets
no width. Visible in Storybook: Charts/Heatmap, Loading.

## Verification

- Charts/Heatmap: the Loading grid is as wide as the loaded one beside it.
