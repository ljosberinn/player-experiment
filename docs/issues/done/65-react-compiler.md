# 65 — Let the compiler do the memoizing

`src` contains two memo calls in total, both in `BrowseView`. That is not
discipline, it is the position phase 25 argued for: file splitting delivers
nothing, a component boundary does, and `memo(SongTable)` was declined because
the table subscribes to the selection itself. React Compiler memoizes every
component and hook at build time, which changes what that argument is weighed
against — hand memoization is no longer the alternative to moving a
subscription.

`@vitejs/plugin-react` 6.1 already carries the switch: `compiler?: boolean |
ReactCompilerOptions`, which runs `oxc-transform-react` — a Rust port, an
optional peer, marked experimental by the plugin. The Babel route is the
reference implementation and pulls `@rolldown/plugin-babel`, `@babel/core` and
`babel-plugin-react-compiler` into a toolchain that is otherwise oxc-only.
React is 19.1, so no `react-compiler-runtime` shim is needed either way.

Vitest shares `vite.config.ts`, so the unit run and `App.renders.test.tsx`
execute compiled components, and the e2e job builds the app. The render counts
that file asserts will move. They are the measurement, not the target — a lower
count is the point, but the number changing silently is what the file exists to
prevent. Most of its assertions are `toBe(0)` and cannot improve; the two floors
of `1` can.

## Decided

- **oxc, not Babel.** One dev dependency instead of three, no second transform
  pass over every `.tsx`, and it is the plugin's own option. The port turns out
  to expose the full option surface — `compilationMode`, `panicThreshold`,
  `target`, gating, the environment validation flags — so choosing it gives up
  none of the configuration the decision was weighed against.
- **The whole tree, at the `infer` default.** That is every component and hook,
  which is what `src` is. `compilationMode: "annotation"` would make the
  compiler another thing to remember per file; `"all"` compiles plain functions
  too and is not what the compiler recommends.
- **A bailout fails the build.** `panicThreshold: "all_errors"`. Biome has no
  react-compiler rule and this repo has no ESLint, so nothing in `npm run lint`
  would report a file the compiler skipped; without the threshold the only
  channel is a build log nobody reads. It is the same stance as the `onwarn`
  handler in the same file, and it costs the same thing: a rules-of-React
  violation breaks `vite dev`, not only CI.

## What is left to win

[60](../done/60-a-row-click-re-renders-the-table.md) landed first, deliberately:
it moved the selection subscription out of `App`, where the compiler would have
papered over the wrong placement by memoizing `resolveColumns` and four closures
around it. The remaining candidate is the table's own rows
([63](63-every-visible-row-re-renders.md)).

`vite.config.ts` turns every rollup warning into a build failure. Check the
compiler's output against that before assuming the build stays green, and
update [frontend.md](../../knowledge/frontend.md) — the subscription-lever
section states hand memoization as the alternative it rejected.
