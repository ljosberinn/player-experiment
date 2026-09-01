# 58 — The lockfile drift Dependabot cannot see

Nothing needs adopting by hand: every crate in `Cargo.toml` and every package in
`package.json` is already at its latest major. What is stale is either arriving
on its own or arriving never, and the second half is the issue.

## Arriving on its own

Ten npm packages are behind by a patch or minor, all inside their existing `^`
range — the three `@tauri-apps/plugin-*`, `@biomejs/biome`,
`@testing-library/react`, `@types/node`, `@vitejs/plugin-react` and three
`@wdio/*`. Dependabot is weekly and last opened a batch on 2026-08-29, so these
are the next `npm-minor-and-patch` group. No action.

## Arriving never

`cargo update --dry-run` on `src-tauri` moves 76 crates and adds 18 (`jiff`,
`windows 0.62`, `zlib-rs`, `miniz_oxide 0.9`, `defmt`, …). Three of the 76 are
direct — the Tauri plugins, which Dependabot will bump on schedule. The other 91
are transitive, none is named in `Cargo.toml`, and Dependabot's cargo updates are
driven by the manifest, so it has never opened one. Nine merged Dependabot
commits since phase 42 and the lock has drifted this far anyway.

That matters because `cargo-deny check advisories` reads the lock. An advisory
published against a transitive crate the lock is pinning turns CI red on the
next code push, with no pull request that fixes it and no obvious culprit — the
fix is a `cargo update` somebody has to think to run.

The 18 new crates are also 18 new attributions, but `THIRD-PARTY-NOTICES.md` is
generated at build time and CI's `notices` job already runs the generator, so a
crate arriving without licence text fails loudly on its own.

## Nothing watches an unchanged tree

`cargo-deny` runs under `if: needs.changes.outputs.code == 'true'`, so an
advisory published against today's lock is invisible until the next code push.
`npm audit` runs nowhere. Dependabot alerts are disabled for the repository —
the alerts API answers `403 Dependabot alerts are disabled for this repository`
— so security updates cannot open anything either. Three ways to hear about a
vulnerability and all three are off unless someone happens to push Rust.

For the record, `npm audit` today: 16 findings, 15 high, every one inside the
WebdriverIO dev tree. Dev-only, so none of it reaches a bundle or the notices
file, which reads production lock entries only.

- `extract-zip` symlink traversal, through `@puppeteer/browsers`. The only one
  `npm audit fix` resolves without a breaking change.
- `deepmerge-ts` <8.0.0. `@wdio/config` and `@wdio/utils` both still ask for
  `^7.0.3` at 9.31.5, so this needs an `overrides` entry or an upstream release.
- `serialize-javascript` ≤7.0.4, through `mocha`. `@wdio/mocha-framework@9.31.5`
  pins `mocha: ^10.3.0`; the fixed `serialize-javascript@7.1.1` only arrives
  with mocha 12.

## To decide

- **How the lock gets updated.** `versioning-strategy: lockfile-only` on the
  cargo entry is one line, but it trades away manifest bumps — the majors that
  were real work (`sha2` 0.10→0.11, `lofty` 0.24→0.25, `ts-rs` 11→12) stop
  arriving. A scheduled workflow running `cargo update` and opening a pull
  request keeps both, and needs its own merge path: the `Dependabot` land job
  gates on `actor.login == 'dependabot[bot]'` and will not touch it.
- **Whether to enable Dependabot alerts.** A repository setting, not a file
  here. It is what makes npm security updates possible; it also means the wdio
  dev-tree findings arrive as alerts nobody can close.
- **Whether the dev-tree advisories deserve `overrides` at all.** Forcing
  `deepmerge-ts@^8` past a `^7.0.3` requirement is telling npm something untrue
  about a tree only `npm run e2e` ever loads.
