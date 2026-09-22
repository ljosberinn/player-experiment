# 126 — CI stops evicting its own caches

The repository is at its cache limit and has been evicting the entries every
run restores from. Measured on 2026-09-22:

```
10.05 GB across 67 caches   — the GitHub limit is 10 GB, LRU eviction above it
  PR-scoped        33 caches   3.79 GB
  refs/heads/main  34 caches   6.26 GB

by family
  node-cache           56   3.90 GB
  v0-rust-rust-tests    3   2.46 GB
  v0-rust-e2e-build     3   2.18 GB
  v0-rust-installers    2   1.08 GB
  v0-rust-notices       3   0.43 GB
```

A cache written on a pull request branch is readable only from that pull
request. The 3.79 GB is therefore never restored by anything — and because the
budget is shared, writing it evicts the main-branch entries that every run does
restore from. Pull request 224 alone wrote 1.82 GB this way (`rust-tests`
880 MB, `e2e-build` 783 MB, `notices-metadata` 155 MB).

That is what a cold `rust` job is. `#125` measures one at 11m05s against a warm
6m19s.

## Three changes

**`save-if: ${{ github.ref == 'refs/heads/main' }}` on `ci.yml`'s three
`Swatinem/rust-cache` steps.** Restores are unaffected — a pull request reads
its base branch's cache either way — and `push: main` is a full gate, so every
merge repopulates all three. This is the pattern the action's own README
recommends.

**`save-if: false` on `release.yml`'s.** `v0-rust-installers` is a
release-profile target directory holding 1.08 GB for a job that runs once per
release, by which time it is both stale and evicted.

**`.github/workflows/prune-caches.yml`, on `pull_request: closed`.** What is
left after the two above is the npm cache, which `actions/setup-node` writes
with no way to opt out: ~160 MB per pull request, duplicating a main-branch
entry under the same lockfile hash. Deleting a closed pull request's caches by
`ref` reclaims it.

## What this does not do

**No cache is shared between jobs that do not already share one.** `rust`,
`e2e` and `installers` keep distinct `shared-key`s: test, debug + `wdio`
feature, and release profile compile different artifacts, and one key across
them would evict on every alternation. `notices` keeps `cache-targets: false`.

**cargo-deny's advisory database stays uncached.** The whole job is 24–29s.

## Verification

- A pull request run restores all three Rust caches and writes none. `gh api
  repos/{owner}/{repo}/actions/caches?ref=refs/pull/{n}/merge` lists only npm
  entries while it is open, and nothing once it is closed.
- The merge's `push: main` run writes all three.
- Total usage falls below 10 GB and stays there:
  `gh api repos/{owner}/{repo}/actions/cache/usage`.
- The next cold-cache `rust` job on a pull request branch is a cache miss
  because the lockfile changed, not because main's entry is gone.

Lands before `#125`, which is measured in billed minutes and whose worst
figure is an eviction rather than the missing path filter it argues for.
