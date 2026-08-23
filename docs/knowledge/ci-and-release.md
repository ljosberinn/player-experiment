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
| `notices` | the third-party notices can still be generated |
| `e2e` (windows) | instrumented debug build plus the WebdriverIO suite |

Caching is `Swatinem/rust-cache` plus the setup-node npm cache; a concurrency
group cancels superseded runs.

**Build warnings fail CI.** `vite.config.ts` turns every bundler warning into a
thrown error — rolldown's since vite 8, rollup's before it; the `onwarn` hook is
the same either way. Silencing a specific `warning.code` with a comment is allowed —
there is one accepted exception, scoped to cycles entirely inside
`node_modules` — loosening it back to the default handler is not.

**Inspecting state:** `gh` is installed and authenticated. `gh pr checks <n>`,
`gh run list --branch <b>`, `gh run watch <id>`, `gh run view <id> --log-failed`.

## Dependabot

`.github/dependabot.yml` watches npm, cargo and `github-actions` weekly. Patches
and minors arrive batched per ecosystem; majors are opened one at a time, so a
red run points at one suspect. Two npm groups are the exception —
`vite` + `@vitejs/*` and `vitest` + `@vitest/*` — because those cannot be
installed one at a time: the first scheduled run opened four separate pull
requests that each failed at `npm ci` with ERESOLVE.

`.github/workflows/dependabot.yml` then lands them: green run on a
`dependabot/*` branch → squash-merge. Majors included; the gate is the same six
checks either way. It runs on `workflow_run` because a workflow triggered by
Dependabot gets a read-only token — GitHub's rule, not a setting — and cannot
merge anything, while a `workflow_run` workflow runs from the default branch
with the repository's own token.

It touches the branch in no other way, and that is the whole trick. Phase 45 had
it regenerate `THIRD-PARTY-NOTICES.md` and push, because the drift check on that
file failed on every update by construction. **A `GITHUB_TOKEN` push parks a
`pull_request` run at `action_required` rather than starting one**, and a parked
run blocks the merge by itself however green the rest is — the pull request sits
at `BLOCKED` until somebody approves the parked run by hand. Phase 46 stopped
committing the file, so there is nothing to push and nothing parks.

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
- `THIRD-PARTY-NOTICES.md` is bundled as an installer resource alongside
  `LICENSE`. symphonia is MPL-2.0, so recipients must be told where to get its
  source — that file is how. It is **generated, not committed**:
  `beforeBuildCommand` runs `npm run notices`, so every bundle describes the
  graph it is shipping. The generator skips its work when the file is newer than
  both lockfiles; `--force` overrides that, and CI passes it.
- Because it is generated, it is listed in `src-tauri/tauri.release.conf.json`
  and **not** in the base config: `tauri-build` fails the *compile* when a
  resource path does not exist, so listing it in the base would mean no
  `cargo test` or `cargo clippy` without generating it first. The release job
  passes that overlay with `--config`. A `--config` overlay replaces an array
  rather than extending it, so the overlay repeats `../LICENSE` too, and
  `src/notices.test.ts` asserts all of that still holds.
