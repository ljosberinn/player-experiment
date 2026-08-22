# 42 — The dependencies, and who watches them

No feature. Maintenance accumulated since phase 1, found by `npm outdated` on
2026-08-05 rather than by anything breaking. Re-run it before starting — the
version numbers below have aged.

**One PR:** remove `@tanstack/react-table`, take the in-range updates, add
Dependabot.

- `@tanstack/react-table` has been a dependency since the scaffold and has never
  been imported. The songs table is hand-rolled because the row model is
  server-side paging over SQLite — sorting, filtering and pagination all live in
  Rust, which is everything a table library exists to own. Removing it also drops
  a licence entry we currently attest to for code that never ships, and settles
  what to do about its 9.0.0. `@tanstack/react-virtual` **is** used and stays.
- In-range: `@base-ui/react` 1.6→1.7, `@biomejs/biome` 2.5.6→2.5.7,
  `@testing-library/user-event` 14.6.1→14.6.3, the four `@wdio/*` to 9.30.1,
  `@wdio/tauri-plugin`/`@wdio/tauri-service` 1.2→1.3. **The wdio bump needs a
  real CI run**, not a green `npm ls`: its failure mode is "the suite cannot
  start".
- A grouped weekly Dependabot config over npm, cargo and `github-actions`, with
  patches and minors batched per ecosystem and majors opened individually.
  `.github/` currently holds `workflows/` and nothing else, which is why this
  accumulated silently.

**Then one PR per major**, because a red run has to point at one suspect:

| Package | → | Why it is where it is |
| --- | --- | --- |
| `@testing-library/jest-dom` | 7 | A handful of matchers; small surface |
| `@vitejs/plugin-react` | 6 | Two majors of mostly peer-range churn |
| `vitest` + `@vitest/coverage-v8` | 4 | Move together; coverage thresholds may be expressed differently |
| `jsdom` | 30 | Four majors — the one that surfaces latent assumptions |
| `vite` | 8 | After plugin-react, and only once Tauri v2 supports it |
| `typescript` | 7 | The native port, a different compiler. Its own branch, nothing else in it |

Rust: `ts-rs` 11→12 and `sha2` 0.10→0.11 are the only breaking ones.
`rusqlite`, `lofty`, `rodio` and `tauri` are current.

Also here: drop the `@wdio/native-utils` override once
`@wdio/tauri-service` repins it.
