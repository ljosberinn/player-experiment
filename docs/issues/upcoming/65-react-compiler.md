# 65 — Let the compiler do the memoizing

`src` contains two memo calls in total, both in `BrowseView`. That is not
discipline, it is the position phase 25 argued for: file splitting delivers
nothing, a component boundary does, and `memo(SongTable)` was declined because
the table subscribes to the selection itself. React Compiler memoizes every
component and hook at build time, which changes what that argument is weighed
against — hand memoization is no longer the alternative to moving a
subscription.

`@vitejs/plugin-react` 6 already carries the switch. `react({ compiler: true })`
runs `oxc-transform-react`, a Rust port, installed as an optional peer and
marked experimental by the plugin. The Babel route is the reference
implementation and pulls `@rolldown/plugin-babel`, `@babel/core` and
`babel-plugin-react-compiler` into a toolchain that is otherwise oxc-only.
React is 19.1, so no `react-compiler-runtime` shim is needed either way.

Vitest shares `vite.config.ts`, so the unit run and `App.renders.test.tsx`
execute compiled components, and the e2e job builds the app. The render counts
that file asserts will move. They are the measurement, not the target — a lower
count is the point, but the number changing silently is what the file exists to
prevent.

To decide:

- **oxc or Babel.** oxc keeps the build single-toolchain and fast and is the
  plugin's own option; it is a port, and a port can differ from the compiler
  React documents. Babel is the reference and costs three dev dependencies and
  a second transform pass over every `.tsx`.
- **What is left to win.** [60](../done/60-a-row-click-re-renders-the-table.md)
  landed first, deliberately: it moved the selection subscription out of `App`,
  where the compiler would have papered over the wrong placement by memoizing
  `resolveColumns` and four closures around it. The remaining candidate is the
  table's own rows ([63](63-forty-rows-render-for-one-click.md)).
- **How a bailout becomes visible.** A component that breaks the rules of React
  is skipped silently. Biome has no react-compiler rule and this repo has no
  ESLint, so nothing in `npm run lint` will say which files were left
  uncompiled — the compiler's own report or health check is the only channel.
- Whether `compilationMode: "annotation"` is worth a first pass, or the whole
  tree goes at once given how small it is.

`vite.config.ts` turns every rollup warning into a build failure. Check the
compiler's output against that before assuming the build stays green, and
update [frontend.md](../../knowledge/frontend.md) — the subscription-lever
section states hand memoization as the alternative it rejected.
