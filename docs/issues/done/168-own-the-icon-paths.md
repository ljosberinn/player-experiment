# 168 — Own the icon paths

`@phosphor-icons/react` was 78 KB rendered for 22 icons: each module carries
all six weights, the app draws one or two. Last published 2025-05.
`registry.tsx` was the only importer.

The 24 icon-weight paths `ICONS` draws are copied into
`components/icons/phosphor/paths.ts`, with Phosphor's MIT `LICENSE` beside them.
`scripts/notices.mjs` credits them through a hand-kept `VENDORED` list, fails
when a vendored copy has no licence text, and counts itself as an input to its
staleness check so an edit to that list regenerates the file.

## Verification

- Every name renders byte-identical markup to the package's, checked before
  removal.
- `THIRD-PARTY-NOTICES.md` still credits Phosphor.
