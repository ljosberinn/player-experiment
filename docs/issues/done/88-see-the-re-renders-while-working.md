# 88 — See the re-renders while working

Phases 25, 60, 63 and 65 all turned on the same question — what woke up when one
value changed — and all four answered it the same way: read the code, guess,
write a render-counting test, run it. `App.renders.test.tsx` and
`SongTable.renders.test.tsx` are the good half of that; the guessing is the half
worth removing. `react-scan` outlines every component that re-rendered, in the
running window, as it happens, and says which prop or store read caused it.

**Dev only, and off unless asked for.** Nothing here is a runtime feature and
nothing here ships. `react-scan/monitoring` — the hosted production side of the
same package — is out of scope and stays out.

## Decided

- **The import API in `main.tsx`, not the Vite plugin.** `react-scan`
  instruments `react-dom` when its module loads, so it has to load before
  `ReactDOM.createRoot` runs; `@react-scan/vite-plugin-react-scan` achieves
  that by injecting a script into `index.html`, which is a fourth-party plugin
  in the toolchain and a load path that is invisible from `src`. A dynamic
  import in `main.tsx` is already the shape this file uses for
  `@wdio/tauri-plugin`, and it puts the guard where a reader will find it.
- **Awaited, unlike the e2e import.** That import is deliberately not awaited —
  the plugin polls for what it needs and blocking first paint would change the
  thing under test. This one is the opposite: instrument after the first render
  and the first render is the one you cannot see. Top-level `await` before
  `createRoot`.
- **`import.meta.env.DEV && import.meta.env.VITE_SCAN === "true"`.** Both
  halves earn their place. `VITE_SCAN` keeps a normal `npm run dev` free of a
  canvas overlay over the whole UI — a `dev:scan` script turns it on. `DEV` is
  what guarantees the elimination: it is a hard `false` in every build, so a
  build that happens to inherit `VITE_SCAN` from the environment still cannot
  ship the import. `VITE_SCAN` joins `ImportMetaEnv` in `vite-env.d.ts` with
  the same note its neighbour carries.
- **A devDependency.** `npm run notices` reads the production entries of
  `package-lock.json` only (`scripts/notices.mjs`), so the notices file does not
  move. Dependabot will bump it under phase 45's rules like any other dev tool.

## What it does not replace

The two render-counting test files stay, and stay the CI guard.
`react-scan` needs a real browser and a canvas — it cannot run in jsdom — and a
live overlay asserts nothing. It is the instrument you reach for *before*
writing the count, and the one that tells you which prop moved when a count you
expected to be zero is not.

React Compiler runs over the tree (`vite.config.ts`), which is what makes the
overlay honest rather than confusing: a child held still by the compiler simply
does not light up, and the two components behind `"use no memo"` — `SongTable`
and `BrowseView` — light up because they really did render.

## Watch for

- **The CSP needs no change, and the reason is worth knowing.**
  `default-src 'self'` rules out the `unpkg` script tag the package's README
  leads with; a bundled import is same-origin and fine. The toolbar styles
  inline, which `style-src 'self' 'unsafe-inline'` already permits.
- **`vite.config.ts` turns every rollup warning into a build failure.** A dead
  dynamic import is what the `VITE_E2E` branch already is, so the pattern is
  proven — but check `npm run build` rather than assuming it.
- **The e2e job must never see the overlay**, or every screenshot in a pull
  request body gains outlines. It builds with `tauri build --debug`, which is a
  Vite *production* build, so `DEV` is false there; nothing to configure, but it
  is the failure mode to keep in mind if the guard is ever loosened.

Testing: nothing to unit test — `main.tsx` is excluded from coverage and the
behaviour is a browser overlay. The verification is by hand and belongs in the
pull request checklist: `npm run dev` shows no overlay, `npm run dev:scan` shows
one and outlines rows on a click, and `dist/` after `npm run build` contains no
occurrence of `react-scan`.

[frontend.md](../../knowledge/frontend.md)'s subscription-lever section names the
render tests as how this project measures renders; it gains the overlay as the
other half, and is the one place `dev:scan` needs writing down.

Independent of everything else in this folder — 82, 83, 85 and 87 neither wait
on it nor are waited on.
