# 42 — The dependencies, and who watches them

No feature. Maintenance accumulated since phase 1, found by `npm outdated` on
2026-08-05 rather than by anything breaking.

**The first PR is done.** `@tanstack/react-table` is gone, the in-range updates
are taken, and `.github/dependabot.yml` watches npm, cargo and `github-actions`
weekly — patches and minors batched per ecosystem, majors opened individually.
`.github/` held `workflows/` and nothing else, which is why this accumulated
silently.

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

## How the majors landed

**One PR per major**, because a red run has to point at one suspect — with the
two exceptions phase 45 turned into Dependabot groups.

| Package | → | How it went |
| --- | --- | --- |
| `@testing-library/jest-dom` | 7 | Dependabot, alone |
| `jsdom` | 30 | Dependabot, alone |
| `typescript` | 7 | The native port. Its own branch, nothing else in it |
| `@vitejs/plugin-react` + `vite` | 6, 8 | Together — see below |
| `vitest` + `@vitest/coverage-v8` | 4 | Together — coverage thresholds carried over unchanged |

Rust: `ts-rs` 11→12 and `sha2` 0.10→0.11 both landed. `rusqlite`, `lofty`,
`rodio` and `tauri` were already current.

`npm outdated` is empty and the two breaking crates named above are taken,
which closes this.

## The four that had to be taken by hand

Dependabot's **first** scheduled run opened `vite@8`, `@vitejs/plugin-react@6`,
`vitest@4` and `@vitest/coverage-v8@4` as four separate pull requests, hours
before phase 45 added the groups that would have batched them. Grouping applies
when a pull request is *opened*, so the four already-open ones stayed as they
were: four red runs, each failing at `npm ci` with `ERESOLVE`, each blocked on
one of the others.

There is no merge order that fixes that. Every one of them carries a lockfile
resolved against the *old* version of its partner, so landing any one of them
alone leaves `main` uninstallable until the partner lands too — and the partner
cannot land, because its own `npm ci` fails first.

So the four were taken together in one hand-made pull request, and Dependabot
closed its own as superseded once that reached `main`. Closing them by hand
would have been the wrong move: Dependabot reads a manually closed pull request
as "do not offer this version again".

Two notes on that PR:

- **The lockfile was regenerated rather than edited.** `npm install` refuses to
  move four packages through a peer conflict in place — it reports the
  `ERESOLVE` against the entries already in the file — so the fix is to delete
  `package-lock.json` and resolve from the manifest. The churn is large and
  entirely dev-side: the production tree comes out identical, package for
  package and version for version.
- **vite 8 builds through rolldown**, and the warnings-are-errors `onwarn`
  handler in `vite.config.ts` survives the change of bundler unmodified.
