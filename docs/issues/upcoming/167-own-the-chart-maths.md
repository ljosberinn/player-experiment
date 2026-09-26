# 167 — Own the chart maths

`scales.ts` uses d3's `scaleLinear` (with `.ticks`) and `arc`, and nothing
else. They pull seven d3 packages (46 KB rendered) and two `@types`; upstream
last published 2023. Callers: `Bar` (domain `[0, largest]`) and `Donut`.

Replace with a linear map, d3's tick-increment rule, and an arc path that draws
a full turn as two half-turns. Written, not copied: the notices stop listing d3.

## Verification

- `scales.test.ts` and `Donut.test.tsx` pass unchanged.
- No `d3-` entry left in `package-lock.json`.
