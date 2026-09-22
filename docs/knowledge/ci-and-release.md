# CI, branches and releases

## The gate

`.github/workflows/ci.yml` runs on `pull_request` and `push: main`. Six checks
are required before merge:

| Job | Runs |
| --- | --- |
| `changes` | path filter: `code` (is anything here not prose) and `e2e` (does anything here reach the built app) |
| `frontend` (ubuntu) | `npm run tauri:parity`, `tsc --noEmit` for `src/` and `e2e/`, Biome, `vitest run --coverage` (80% threshold), `npm run build`, `npm run build-storybook` |
| `rust` (windows) | `cargo fmt --check`, `cargo clippy --all-targets -D warnings`, `cargo test` under `TZ=EST5EDT`, and a check that committed bindings match the Rust types |
| `cargo-deny` (ubuntu) | advisories, licences, sources, bans |
| `notices` | the third-party notices can still be generated |
| `e2e` (windows) | instrumented debug build plus the WebdriverIO suite |

Caching is `Swatinem/rust-cache` plus the setup-node npm cache; a concurrency
group cancels superseded runs.

## What the gate costs

Nothing, in money: the repository is public and GitHub-hosted minutes are free
for public repositories. Every run reports `billable.total_ms` of zero. The
unit is waiting.

All six jobs start within a second of each other and run in parallel, so the
run is green when the slowest is — `e2e` at about 7m50 against `rust` at 6m19.
**`e2e` is the only job on the critical path.** Skipping any other job shortens
nothing, which is why `changes` emits two booleans rather than one per job:

- `code` — is anything here not prose. Every job's steps read it.
- `e2e` — does anything here reach the bundle the WebdriverIO suite drives.
  Only the `e2e` job reads it, and it being true implies `code` is.

A stories-or-tests-only pull request skips `e2e` and goes from about eight
minutes to under two. A documentation-only one skips everything and takes
about one. Anything unrecognised counts as both, which is why new files need
no arm to be classified correctly.

`src/ci.test.ts` slices the `case` block out of `ci.yml` and runs it through
`bash`, because a misclassification is silent — the gate stops checking
something and still reports green.

Deliberately **not** split further: `rust`, `frontend`, `cargo-deny` and
`notices` all keep reading `code`. None is on the critical path, and each
extra boolean is another way to stop checking something by accident.

## The cache budget

A cache written on a pull request branch is readable **only from that pull
request**. The 10 GB it counts against is the whole repository's, and over the
limit GitHub evicts the least recently used entry — so caches nothing can
restore from evict the main-branch ones every run does. At 10.05 GB across 67
entries, 3.79 GB of it PR-scoped, that is what an 11-minute `rust` job was.

- **`save-if: ${{ github.ref == 'refs/heads/main' }}`** on all three
  `rust-cache` steps in `ci.yml`: restore everywhere, save only from main.
  `push: main` is a full gate, so every merge repopulates all three.
- **`save-if: false`** on `release.yml`'s. A release-profile target directory
  is shared with no other job and stale by the next release.
- **`.github/workflows/prune-caches.yml`** deletes a pull request's caches when
  it closes. This collects the npm cache, which `setup-node` writes with no way
  to opt out — only on a branch that changes a lockfile and so misses its key,
  which is most of what Dependabot opens. `pull_request_target`, because a
  `pull_request` workflow triggered by Dependabot gets a read-only token — the
  same constraint that shapes `dependabot.yml`.

The three Rust `shared-key`s stay distinct: `rust-tests`, `e2e-build` (debug,
`wdio` feature) and the release profile compile different artifacts, and one
key across them would evict on every alternation. `notices` keeps
`cache-targets: false` — it never compiles and wants only the registry.

Check it with `gh api repos/{owner}/{repo}/actions/cache/usage` and
`gh cache list`.

**Build warnings fail CI.** `vite.config.ts` turns every bundler warning into a
thrown error — rolldown's since vite 8, rollup's before it; the `onwarn` hook is
the same either way. Silencing a specific `warning.code` with a comment is allowed —
there is one accepted exception, scoped to cycles entirely inside
`node_modules` — loosening it back to the default handler is not.

**Inspecting state:** `gh` is installed and authenticated. `gh pr checks <n>`,
`gh run list --branch <b>`, `gh run watch <id>`, `gh run view <id> --log-failed`.

## Storybook on Pages

`.github/workflows/storybook.yml` publishes the component library to
<https://ljosberinn.github.io/player-experiment/> on every push to `main`. Free:
the repository is public, and Pages is free for public repositories.

Its own workflow rather than a job on `ci.yml`, because that one is the required
gate and runs on pull requests — a deployment does not belong there. The
`Storybook build` step on the `frontend` job stays regardless: it is what fails a
story that does not compile on the pull request that wrote it. Its concurrency
group is `pages` with `cancel-in-progress: false`, the one case where the newer
run should queue rather than cancel a half-finished deployment.

**One manual setting, outside the repository: Settings → Pages → Source = GitHub
Actions.** Without it `actions/deploy-pages` fails with "Pages is not enabled".

No Vite `base` is needed for the subfolder. `@storybook/builder-vite` hard-codes
`base: "./"` after merging `vite.config.ts`, precisely for subfolder deploys
([builder-vite#238](https://github.com/storybookjs/builder-vite/issues/238)).

## Dependabot

`.github/dependabot.yml` watches npm, cargo and `github-actions` weekly. Patches
and minors arrive batched per ecosystem; majors are opened one at a time, so a
red run points at one suspect. Two npm groups are the exception —
`vite` + `@vitejs/*` and `vitest` + `@vitest/*` — because those cannot be
installed one at a time: the first scheduled run opened four separate pull
requests that each failed at `npm ci` with ERESOLVE.

**Tauri updates always arrive half-done.** `tauri-plugin-updater` is a cargo
dependency and `@tauri-apps/plugin-updater` an npm one, Dependabot groups per
ecosystem, and `tauri build` refuses to start unless the two agree on
major.minor — so a Tauri bump is red by construction until the other half is
pushed onto the same branch by hand. `npm run tauri:parity` says so in the
`frontend` job rather than minutes into the e2e build. Pushing to a
`dependabot/*` branch also costs the auto-merge below, whose `actor` condition
no longer holds; merge those by hand.

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
- **The last.fm key is compiled in from the environment.** `APEX_LASTFM_API_KEY`
  and `APEX_LASTFM_API_SECRET` are read with `option_env!`, so a build made
  without them has the feature **inert** rather than broken: the Account menu
  stays disabled and the Settings pane says the build carries no key. Every
  local build and every CI run is that build — a key is needed to *run* the
  feature, not to test it. The release job is the exception: it passes both from
  repository secrets, and then greps the compiled `apex.exe` for the key before
  publishing. Everywhere else a missing key is the documented state; there it is
  an installer that works in every way a user can see and never scrobbles, so it
  is checked rather than trusted — and checked against the binary, because a
  restored build cache can satisfy the environment without having compiled it
  in. The secret is extractable from any binary that has one, which is inherent
  to last.fm's model and accepted; what limits it is that the secret alone is
  useless without a per-account session key.
- Because it is generated, it is listed in `src-tauri/tauri.release.conf.json`
  and **not** in the base config: `tauri-build` fails the *compile* when a
  resource path does not exist, so listing it in the base would mean no
  `cargo test` or `cargo clippy` without generating it first. The release job
  passes that overlay with `--config`. A `--config` overlay replaces an array
  rather than extending it, so the overlay repeats `../LICENSE` too, and
  `src/notices.test.ts` asserts all of that still holds.
