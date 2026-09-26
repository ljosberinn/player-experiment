# 167 — Own the chart maths

`scales.ts` used d3's `scaleLinear` (with `.ticks`) and `arc`, and nothing
else. They pulled nine d3 packages plus `internmap` (46 KB rendered) and four
`@types`. Callers: `Bar` (domain `[0, largest]`) and `Donut`.

Replaced with a linear map, d3's tick rule, and an arc path that draws a full
turn as two half-turns, rounded to three places as d3's was. Written, not
copied: the notices stop listing d3. A slice within 1e-6 rad of nothing now
draws nothing rather than d3's sliver.

## Verification

- `scales.test.ts` and `Donut.test.tsx` pass with their assertions unchanged.
- No `d3-` entry left in `package-lock.json`.
