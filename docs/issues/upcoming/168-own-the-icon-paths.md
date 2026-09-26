# 168 — Own the icon paths

`@phosphor-icons/react` is 78 KB rendered for 22 icons: each module carries all
six weights, the app draws one or two. Last published 2025-05. `registry.tsx`
is the only importer.

Draw the weights `ICONS` uses from inline path data. The paths stay Phosphor's
(MIT), so its notice must survive: `scripts/notices.mjs` only reads the
lockfile and has no manual entries yet.

## Verification

- Icons render as before (e2e screenshots).
- `THIRD-PARTY-NOTICES.md` still credits Phosphor.
