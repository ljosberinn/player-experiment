# 106 — Storybook

Somewhere a primitive can be drawn in every state, on both grounds, at once.
Neither existing suite does that: Vitest runs in jsdom with no stylesheet, and
the wdio specs photograph whole screens of the running app.

`storybook` + `@storybook/react-vite` at 10.6, framework `@storybook/react-vite`,
`stories: ["../src/**/*.stories.tsx"]`. The existing `vite.config.ts` is reused
as-is; nothing about the build changes.

**Not `@storybook/addon-vitest`** — it peers `vitest ^3 || ^4` and this repo is
on `^5`. Revisit when that widens.

Two globals every story inherits:

- `App.css` imported once in `.storybook/preview.ts`, so a story is drawn by the
  same sheet the app is.
- A theme toolbar item switching the ground, once [108](108-two-grounds.md) has
  defined one. Until then dark is the only value.

`npm run storybook` and `npm run build-storybook`. The build is not wired into
CI in this issue — there is nothing to publish yet and a broken story should
fail on the branch that wrote it, which `build-storybook` in the lint job can do
once a handful exist.

No stories land here beyond one smoke story proving the sheet is applied. Each
component issue brings its own.

Part of the [component library sweep](../../plans/apex-components.md).
