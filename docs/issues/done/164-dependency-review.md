# 164 — Review the dependencies and their alternatives

[42](42-dependency-maintenance.md) kept versions current. This asked, per
direct dependency, whether it still earns its place. Choices already argued in
`Cargo.toml` comments, 42, [65](65-react-compiler.md), [70](70-chart-primitives.md)
and [88](88-see-the-re-renders-while-working.md) were taken as settled unless
the code contradicted them.

**Outcome:** two swaps, [167](../upcoming/167-own-the-chart-maths.md) and
[168](../upcoming/168-own-the-icon-paths.md). `ts-node` (scaffold leftover;
`@wdio/cli` 9 compiles TypeScript through `tsx`) and `@types/mocha` (arrives
through `@wdio/mocha-framework`, which the e2e tsconfig names) were removed
here.

Weight in the frontend is what the webview parses at startup, not a download:
Tauri serves `dist/` from the binary. The production bundle is 860 KB of
minified JS.

## Frontend

Rendered bytes after tree-shaking, before minification, from `vite build`'s
module map.

| Package | Weight | Verdict |
| --- | --- | --- |
| `react`, `react-dom` | 564 KB | Framework. |
| `@base-ui/react` | 485 KB, plus 79 KB of `floating-ui` and `@base-ui/utils` | Keep. Spread over ten primitives on one shared positioning core; none dominates (combobox 69, select 49, menu 47, slider 38). Radix and React Aria are no lighter. |
| `@phosphor-icons/react` | 78 KB for 22 icons | Swap: 168. Every icon module carries all six weights. Last published 2025-05. |
| `d3-scale`, `d3-shape` | 46 KB across seven d3 packages | Swap: 167. `scales.ts` uses `scaleLinear` and `arc`; 70 took `d3-shape` for arc *and* area, and nothing draws an area. |
| `@tanstack/react-virtual` | 45 KB | Keep. Four callers. |
| `@tauri-apps/api`, `plugin-*` | 36 KB | Keep. The IPC side of the Rust plugins. |
| `zustand` | 2 KB | Keep. Every store. |
| `@fontsource/archivo` | 3 × woff2 | Keep. Also bundles a `.woff` per weight that WebView2 never loads (56 KB of installer); not worth an issue. |

Dev tooling is untouched otherwise: every remaining entry has a caller in
`package.json` scripts, a tsconfig, CI, or is a peer of one that does
(`@testing-library/dom`).

## Rust

Crates in the Windows normal/build graph reachable only through that
dependency, of 373 in total.

| Crate | Own crates | Verdict |
| --- | --- | --- |
| `rodio` | 12 (symphonia, cpal) | Core. |
| `image` | 7 | Keep. Decodes, resizes and re-encodes covers, not only decodes. |
| `rusqlite` | 7 (bundled SQLite) | Core. |
| `lofty` | 5 | Core. |
| `rayon` | 5 | Keep. One `par_iter` in `scan`; `std::thread::scope` would lose work-stealing across files of uneven size. |
| `tauri-plugin-*` | 2–4 each | Keep. Updater, folder picker, media keys, opener. |
| `ts-rs` | 3 (proc macro) | Keep. Test-only would mean `cfg_attr` on 129 `#[ts]` attributes to save a proc macro's compile. |
| `sha2`, `md-5`, `unicode-normalization` | 1 each | Keep. Justified in `Cargo.toml`. |
| `tauri`, `reqwest`, `serde`, `serde_json`, `thiserror`, `time`, `walkdir` | 0 | Already in the graph through Tauri. |

Dev crates (`tempfile`, `wiremock`, `tokio`) are test-only and each justified
in `Cargo.toml`.
