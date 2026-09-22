# 125 — CI runs what changed

`ci.yml`'s `changes` job answers one question — is this changeset entirely
prose — and every job reads the same answer. So a pull request that touches
only `src/` pays for `cargo fmt`, `cargo clippy` and `cargo test` on a Rust
tree it did not touch, and a pull request that touches only `src-tauri/src/`
pays for Biome, Vitest and two bundler runs on a frontend it did not touch.

Measured on three recent runs (`35672452856`, `35671285321`, `35669927005`),
all of them frontend-only branches from the component sweep:

| Job | Runner | Wall | Billed |
| --- | --- | --- | --- |
| `changes` | ubuntu | 2–4s | 1 |
| `frontend` | ubuntu | 1m19s–2m09s | 2 |
| `notices` | ubuntu | 18–26s | 1 |
| `cargo-deny` | ubuntu | 24–29s | 1 |
| `rust` | windows | 6m19s–6m22s | 14 |
| `e2e` | windows | 7m41s–7m50s | 16 |

35 billed minutes, of which 16 buy nothing. `rust` has been as slow as 11m05s
on a cold cache, where the waste is 24.

The two Windows jobs are where this is worth anything at all: they carry the
2x multiplier, and `rust` is the one expensive job with a *narrow* input set.
`e2e` builds and drives the whole app, so almost everything reaches it.

## Same shape, more outputs

`changes` keeps its structure — the reason the gate is per-step rather than
per-job has not changed, and the comment at the top of the job still states it
correctly. What changes is that `detect` emits five booleans instead of one,
and each job's steps read its own. **This costs no YAML lines**: every step
already carries an `if`, and it only gets a different expression.

```bash
everything() { rust=true; deny=true; notices=true; frontend=true; e2e=true; }

while IFS= read -r file; do
  case "$file" in
    # A workflow change is code however it is spelled - and `notices.test.ts`
    # reads `release.yml`, so this is not merely caution.
    .github/*) everything ;;

    # Reaches no job. `design/` and `.claude/` are gitignored and cannot
    # appear here at all.
    docs/*|.githooks/*|*.md|LICENSE) ;;

    # Biome lints the whole tree, so anything it parses keeps `frontend`.
    .vscode/*|.storybook/*) frontend=true ;;

    # Vitest reads all four of these: version.test.ts, notices.test.ts,
    # capabilities.test.ts.
    src-tauri/Cargo.toml|src-tauri/Cargo.lock)
      rust=true; deny=true; notices=true; frontend=true; e2e=true ;;
    src-tauri/tauri*.conf.json|src-tauri/capabilities/*)
      rust=true; frontend=true; e2e=true ;;
    src-tauri/*|.cargo/*) rust=true; e2e=true ;;

    deny.toml) deny=true ;;
    package.json|package-lock.json) notices=true; frontend=true; e2e=true ;;
    scripts/notices.mjs) notices=true; frontend=true ;;

    # ts-rs output. `rust` is there for the drift check, which is the only
    # thing that catches a hand edit to a generated file.
    src/ipc/bindings/*) rust=true; frontend=true; e2e=true ;;

    # Neither a unit test nor a story is in the bundle the suite drives.
    src/*.test.ts|src/*.test.tsx|src/*.stories.tsx|src/test/*) frontend=true ;;

    *) frontend=true; e2e=true ;;
  esac
done <<< "$files"
```

`case` patterns are not pathname expansion — `*` crosses `/` — so `docs/*`
takes the whole tree and `src/*.test.ts` takes every test under it. Order is
therefore load-bearing: the four specific `src-tauri/` patterns have to precede
`src-tauri/*`, and `*.md` has to follow `docs/*` only because it is cheaper to
read that way.

Both failure-safe branches stay as they are: not a pull request, or a file list
that could not be read, calls `everything`.

## What this is worth

The same three runs come out at 19 billed minutes instead of 35 — `rust`,
`cargo-deny` and `notices` all skip. A `src-tauri/src/`-only branch that does
not move a type skips `frontend` for another 2.

The two figures in the `changes` comment — "about 4 billed minutes rather than
17" — predate the current job set and should be restated from the table above
while the file is open.

## What does not change

**`push: main` stays a full gate.** Diffing `github.event.before..github.sha`
would work and would roughly double the saving, and it is still wrong here:
`strict_required_status_checks_policy` is `false`, so a branch merges without
being current with `main`, and the post-merge run is the only thing that ever
sees the combination. A frontend branch that skipped `rust` and a Rust branch
that skipped `frontend` can each be green and disagree once both have landed.
Today that run catches it. Squash-diffing would mean nothing ever did.

**The six required contexts stay.** Collapsing them into one aggregating `gate`
job with `needs: [*]` and `if: always()` would let every job carry a job-level
`if` and delete every step-level one, which is the tidier file by a wide
margin. It also means editing ruleset `20232158` from outside the repository,
in the window between the two states, and betting the merge button on how
rulesets score a skipped check. Not with this change. If it is wanted, it is
its own phase and it lands first.

## Verification

Per-class, because a misclassification is silent — it does not fail, it just
stops checking something:

- A branch touching only `docs/` — every job reports, no job does work.
- A branch touching only `src/features/` — `rust`, `cargo-deny`, `notices`
  idle; `frontend` and `e2e` run.
- A branch touching only `src-tauri/src/` — `frontend` idle, the rest run, and
  the bindings drift check still runs.
- A branch touching only `src-tauri/Cargo.lock` — all five run.
- A branch touching `.github/workflows/ci.yml` — all five run. This one is the
  change itself, so the first push proves it.

Then `docs/knowledge/ci-and-release.md`: the table at the top says `changes` is
a "path filter that decides which jobs are needed", which becomes true rather
than aspirational, and the per-job rows want the input set each one now reads.

Independent of the rest of the sequence. Its own worktree.
