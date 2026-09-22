# 125 — CI runs what changed

`ci.yml`'s `changes` job answers one question — is this changeset entirely
prose — and every job reads the same answer. So a pull request that touches
only a story pays for a full instrumented Tauri build and the WebdriverIO
suite on a bundle that cannot contain it.

## What is actually being spent

The first draft of this issue costed the gate in billed minutes. There are
none: the repository is **public**, GitHub-hosted runners are free for public
repositories, and all three runs it cited (`35672452856`, `35671285321`,
`35669927005`) report `billable.total_ms` of zero on both operating systems.
The unit is waiting.

And waiting is not the sum of the jobs, because they do not queue. Per-job
timeline of `35672452856`, relative to the first job's start:

| Job | Runner | Starts | Done |
| --- | --- | --- | --- |
| `changes` | ubuntu | +0s | +2s |
| `notices` | ubuntu | +5s | +23s |
| `cargo-deny` | ubuntu | +5s | +34s |
| `frontend` | ubuntu | +5s | +84s |
| `rust` | windows | +6s | +385s |
| `e2e` | windows | +5s | +475s |

All six start within a second of each other. The run is green when the slowest
one is, so **`e2e` is the only job on the critical path** — `rust` finishes 90
seconds ahead of it even on a warm cache. Skipping `rust` on a frontend-only
pull request, or `frontend` on a Rust-only one, moves the green tick by zero
seconds. That is the whole reason this issue is one boolean and not five.

## One more output

`changes` keeps its shape — the reason the gate is per-step rather than
per-job has not changed. It emits a second boolean beside `code`, and only the
`e2e` job's steps read it.

- `code` — is anything here not prose. Every job reads it, unchanged.
- `e2e` — does anything here reach the bundle the WebdriverIO suite drives.

`e2e` being true implies `code` is. Both fail-safe arms — not a pull request,
or a file list that could not be read — set both.

```bash
case "$file" in
  .github/*) code=true; e2e=true ;;
  docs/*|.githooks/*|*.md|LICENSE) ;;
  src/*.test.ts|src/*.test.tsx|src/*.stories.tsx|src/test/*|e2e/*.unit.test.ts) code=true ;;
  .vscode/*|.storybook/*|deny.toml|.release-please-manifest.json|release-please-config.json) code=true ;;
  *) code=true; e2e=true ;;
esac
```

`case` patterns are not pathname expansion — `*` crosses `/` — so `docs/*`
takes the whole tree and `src/*.test.ts` every test under it. Order is
load-bearing: each arm is reached only by what the ones above did not claim.

The third arm is the one that pays. Biome parses all of it, `tsc` and Vitest
see the tests, Storybook compiles the stories, and none of the three is in the
bundle `npm run e2e` drives. A stories-or-tests-only pull request goes from
about eight minutes to under two, `frontend` becoming the critical path.

The fourth is tooling the gate reads and the app does not. `.vscode/` is
gitignored bar `extensions.json`, so that pattern is one file; the
release-please pair is read by `version.test.ts` and nothing else.

Everything unrecognised falls to `*)` and counts as both — which is why
`e2e/`, `scripts/`, `vite.config.ts`, `biome.json`, `tsconfig.json`,
`index.html` and any new root file need no arm to be classified correctly.

## The classifier is tested

A misclassification is silent: nothing fails, the gate just stops checking
something and still reports green. `src/ci.test.ts` slices the `case` block out
of `ci.yml` and runs it through `bash`, so the patterns under test are the ones
the workflow ships rather than a copy that can drift. Absent `bash`, it skips.

The file list reaches the script on stdin. Windows drops everything past the
first newline in an argv entry, which made every multi-file case look like its
first file alone.

## What does not change

**`push: main` stays a full gate.** Diffing `github.event.before..github.sha`
would work and is still wrong here: `strict_required_status_checks_policy` is
`false`, so a branch merges without being current with `main`, and the
post-merge run is the only thing that ever sees the combination. A frontend
branch that skipped nothing and a Rust branch that skipped nothing can each be
green and disagree once both have landed. It is also what keeps the caches
warm — see `#126`.

**The six required contexts stay.** Collapsing them into one aggregating `gate`
job with `needs: [*]` and `if: always()` would let every job carry a job-level
`if` and delete every step-level one, which is the tidier file by a wide
margin. It also means editing ruleset `20232158` from outside the repository,
in the window between the two states, and betting the merge button on how
rulesets score a skipped check. If it is wanted, it is its own phase.

**The other four jobs keep reading `code`.** Splitting them further is
correct-looking and buys nothing: none of them is on the critical path, and
each extra boolean is another way to stop checking something by accident.

## Verification

- This branch touches `.github/workflows/ci.yml`, so its own first push proves
  the `everything` path: all six jobs do their work.
- A follow-up pull request touching only a `.stories.tsx` reports six green
  checks with `e2e` idle, in under two minutes.
- `changes`' log prints both answers: `Full gate:` and `Drives the app:`.
- Dependabot is unaffected — `dependabot.yml` merges on
  `workflow_run.conclusion == 'success'`, and a job whose steps all skip still
  concludes success.

Stacked on `#126`.
