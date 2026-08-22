# 33 — The colour ramp, dark only

Merged in #52. Tokens listed in [design.md](../../knowledge/design.md).

`App.css` had shipped three colour blocks — a light `:root`, a
`prefers-color-scheme: dark` override, and an explicit `:root[data-theme="dark"]`.
Two went. **What stays is the indirection**: every colour in every component rule
comes from a custom property and no literal colour is written outside the token
block, so restoring a light theme later is one more block of definitions rather
than an audit of six hundred rules. A lint asserts it.

- The design was amended to satisfy `e2e/contrast.ts` rather than the reverse:
  the genre column and table headers went `oklch(0.48)` → `0.72`, the `dim`
  constant `0.62` → `0.72`. The version string was lifted `0.55` → `0.64`, the one
  value still short of 4.5:1.
- Chrome became translucent — `backdrop-filter: blur(18px)` over a surface at
  55–70% opacity — which is what later makes the dynamic background visible
  through the sidebar and transport rather than only behind the table.
- **Space Grotesk** for numerals, shipped as a package rather than fetched from a
  font CDN: the app is offline-first and the CSP forbids the request. Only the
  weights used, and the SIL OFL is in `THIRD-PARTY-NOTICES.md`.
- The Albums/Artists/Genres card grids were restyled here too — `BrowseView`
  already rendered tiles, so this was the token pass reaching them.
