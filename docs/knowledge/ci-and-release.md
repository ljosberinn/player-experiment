# CI, branches and releases

## The gate

`.github/workflows/ci.yml` runs on `pull_request` and `push: main`. Six checks
are required before merge:

| Job | Runs |
| --- | --- |
| `changes` | path filter that decides which jobs are needed |
| `frontend` (ubuntu) | `tsc --noEmit` for `src/` and `e2e/`, Biome, `vitest run --coverage` (80% threshold), `npm run build` |
| `rust` (windows) | `cargo fmt --check`, `cargo clippy --all-targets -D warnings`, `cargo test`, and a check that committed bindings match the Rust types |
| `cargo-deny` (ubuntu) | advisories, licences, sources, bans |
| `notices` | `THIRD-PARTY-NOTICES.md` is current |
| `e2e` (windows) | instrumented debug build plus the WebdriverIO suite |

Caching is `Swatinem/rust-cache` plus the setup-node npm cache; a concurrency
group cancels superseded runs.

`.github/dependabot.yml` watches npm, cargo and `github-actions` weekly. Patches
and minors arrive batched per ecosystem; majors are opened one at a time, so a
red run points at one suspect.

**Build warnings fail CI.** `vite.config.ts` turns every rollup warning into a
thrown error. Silencing a specific `warning.code` with a comment is allowed —
there is one accepted exception, scoped to cycles entirely inside
`node_modules` — loosening it back to the default handler is not.

**Inspecting state:** `gh` is installed and authenticated. `gh pr checks <n>`,
`gh run list --branch <b>`, `gh run watch <id>`, `gh run view <id> --log-failed`.

## Branches

`main` is protected server-side by the `no-master-push` ruleset: no deletion, no
force-push, PR only, all six checks required, no bypass actors. One feature
branch per phase, squash-merged.

`strict_required_status_checks_policy` is deliberately **off** — requiring every
branch to be current with `main` would re-run the whole gate on every PR each
time anything lands.

`.githooks/` (wired by the `prepare` script) is a fast-fail convenience, not the
enforcement: pre-commit runs Biome on staged files and `cargo fmt --check`;
pre-push adds repo-wide Biome, typecheck and rustfmt on top of a `main` block.

## Releases

Conventional commit titles feed **release-please**, which keeps one open release
pull request holding the version bump and the changelog. Merging it cuts the tag
and the GitHub release; nothing publishes while the PR sits there.

- `bump-minor-pre-major`: below 1.0.0 a `feat` bumps the minor and a breaking
  change does not jump to 1.0.0.
- The version lives in **three files** — `package.json`, `tauri.conf.json`,
  `Cargo.toml` — and `src/version.test.ts` asserts they agree.
- `tauri.conf.json` and the release-please manifest are **excluded from the
  formatter**, not from Biome: release-please re-serializes them with its own
  printer and Biome wants to undo it. Irreconcilable by configuration.
- **Installers are unsigned**, settled at the start: local-only product, no code
  signing. SmartScreen warns on first run of each new version until reputation
  accrues. Nothing to fix.
- `THIRD-PARTY-NOTICES.md` is generated (`npm run notices`) and bundled as an
  installer resource alongside `LICENSE`. symphonia is MPL-2.0, so recipients
  must be told where to get its source — that file is how.
