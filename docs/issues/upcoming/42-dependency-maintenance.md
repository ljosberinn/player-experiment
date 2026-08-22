# 42 — The dependencies, and who watches them

No feature. Maintenance accumulated since phase 1, found by `npm outdated` on
2026-08-05 rather than by anything breaking.

**The first PR is done.** `@tanstack/react-table` is gone, the in-range updates
are taken, and `.github/dependabot.yml` watches npm, cargo and `github-actions`
weekly — patches and minors batched per ecosystem, majors opened individually.
`.github/` held `workflows/` and nothing else, which is why this accumulated
silently. What is left is the majors table below.

`@tanstack/react-table` had been a dependency since the scaffold and was never
imported. The songs table is hand-rolled because the row model is server-side
paging over SQLite — sorting, filtering and pagination all live in Rust, which
is everything a table library exists to own. Removing it also drops a licence
entry we attested to for code that never shipped, and settles what to do about
its 9.0.0. `@tanstack/react-virtual` **is** used and stays.

Three things the first PR learned, all of them about wdio:

- The versions had aged as predicted: biome landed on 2.5.10 rather than the
  2.5.7 this file named, user-event on 14.6.6, the `@wdio/*` four on 9.31.x.
- `@wdio/globals` **kept its `^9.29.1` floor**. `@wdio/tauri-service` pins it
  exactly, so raising the root floor to match `@wdio/local-runner@9.31.x` is an
  `ERESOLVE`, not a resolution. The two versions now coexist as separate copies
  in the tree — which is the part **only a real CI e2e run** can vindicate,
  since the failure mode here is "the suite cannot start".
- The `@wdio/native-utils` override is dropped: `@wdio/tauri-service@1.3.0` pins
  2.6.0 itself, so the override could only hold the tree back.

**One PR per major**, because a red run has to point at one suspect:

| Package | → | Why it is where it is |
| --- | --- | --- |
| `@testing-library/jest-dom` | 7 | A handful of matchers; small surface |
| `@vitejs/plugin-react` | 6 | Two majors of mostly peer-range churn |
| `vitest` + `@vitest/coverage-v8` | 4 | Move together; coverage thresholds may be expressed differently |
| `jsdom` | 30 | Four majors — the one that surfaces latent assumptions |
| `vite` | 8 | After plugin-react, and only once Tauri v2 supports it |
| `typescript` | 7 | The native port, a different compiler. Its own branch, nothing else in it |

Re-run `npm outdated` before starting one — these have aged once already.

Rust: `ts-rs` 11→12 and `sha2` 0.10→0.11 are the only breaking ones.
`rusqlite`, `lofty`, `rodio` and `tauri` are current.
