# 106 — Storybook

Somewhere a primitive can be drawn in every state, on both grounds, at once.
Neither existing suite does that: Vitest runs in jsdom with no stylesheet, and
the wdio specs photograph whole screens of the running app.

`storybook` + `@storybook/react-vite` at 10.6, framework `@storybook/react-vite`,
`stories: ["../src/**/*.stories.tsx"]`.

**Not `@storybook/addon-vitest`** — it peers `vitest ^3 || ^4` and this repo is
on `^5`. Revisit when that widens.

## What the project's Vite config costs: nothing

The framework merges `vite.config.ts`, and no `viteFinal` is needed — which is
worth writing down, because both halves of it look like they would be.

- `build` never arrives. `commonConfig` in `@storybook/builder-vite`
  destructures the loaded user config and keeps only `build.target`, so the
  `onwarn` handler that makes every build warning an error is not in force. That
  is the right outcome rather than a lucky one: a Storybook build ships nothing,
  and its virtual modules and runtime are not code this project can act on. It
  prints the 500 kB chunk-size warning and carries on.
- `server` is merged and then replaced wholesale. The preview server runs in
  `middlewareMode` behind Storybook's own, so the port 1420 `strictPort` pin
  Tauri needs is dropped. Verified: `npm run dev` on 1420 and `npm run storybook`
  on 6006 are up at the same time.

What does carry over is the part that should: the plugin list, and with it React
Compiler at `panicThreshold: "all_errors"`. Verified by building a story with a
conditional `useState` — `react-compiler(Hooks)` failed the build.

`core.disableTelemetry`, because a player that forbids network access in its own
CSP should not phone home from its component library.

## Three globals every story inherits

`.storybook/preview.ts` imports `App.css` **and** the faces — two
`@fontsource/space-grotesk` weights when this landed, the three Archivo weights
since 107. The sheet alone is not the app's typography: those imports live in
`main.tsx`, and without them a specimen is drawn in a system fallback.

`.storybook/preview.css`, last, for the two rules `App.css` puts on `body`
because the app is a window and a specimen sheet is not: `overflow: hidden`,
which would clip a specimen taller than the frame with no way to scroll it, and
`user-select: none`, which would mean a token name has to be retyped rather than
copied.

Typography is **not** among them, though it looks like it should be — Storybook
10 puts Nunito Sans on `.sb-wrapper` and the navigator, never on a bare `body`,
so `:root` inheritance already reaches a story untouched. A `font-family:
inherit` here would be inert and would tell 107 there are two places to change.

The ground needs nothing either: the window fill is on `html`, which the story
frame inherits, and `body` stays transparent.

No theme toolbar here — [108](108-two-grounds.md) brought the second ground and
the Ground switch with it.

## Four places outside `.storybook/`

- `vite.config.ts`: `src/**/*.stories.tsx` into `coverage.exclude`. The include
  is `src/**/*.{ts,tsx}` against 80% thresholds, and Vitest never runs a story.
- `tsconfig.json`: `.storybook` into `include`, or `npm run typecheck` never
  reads the config Biome is already linting.
- `.gitignore`: `storybook-static`.
- `package.json`: `storybook` and `build-storybook`.

## CI

`npm run build-storybook` as a step on the `frontend` job. Wired here rather
than deferred: 107 through 117 each bring stories, and a story that does not
compile should fail on the branch that wrote it.

## The one story

`src/styles/Tokens.stories.tsx` — every `:root` token as a labelled swatch. It
proves the sheet reached the frame without a primitive existing yet, and it is
what 107, 108 and 109 are read against while they land. Every other story
arrives with its own component.

Read out of the live `CSSStyleSheet` rather than written out, so it cannot go
stale under the three issues that rewrite the block. `--lightningcss-light` and
`--lightningcss-dark` are skipped by name: Vite's minifier appends them to
`:root` when it lowers `color-scheme`, so a built sheet declares two properties
no source file does and `storybook dev` does not show. Each swatch is drawn over
`--sidebar`, `--surface` and `--text` in thirds, which is the only way a
translucent token reads as one.

Part of the [component library sweep](../../plans/apex-components.md).
