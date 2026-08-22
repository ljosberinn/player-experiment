# 45 — Dependabot lands its own updates

Phase 42 pointed Dependabot at npm, cargo and the actions, and the first
scheduled run opened twelve pull requests at once. Eleven of them failed
`notices` — including several whose only fault was that.

`THIRD-PARTY-NOTICES.md` is generated from the resolved dependency graph, so
every update that touches a shipped package invalidates it, and Dependabot
cannot run a generator. The one check its pull requests are certain to fail is
the one about the file they just made stale, and clearing it by hand is a
checkout, an install and a push per update — which is the whole reason nobody
watched the dependencies until phase 42.

`.github/workflows/dependabot.yml` regenerates the file and merges what is
green.

## Why `workflow_run`, and why a dispatch

A workflow triggered by Dependabot gets a **read-only** token — that is
GitHub's rule, not a setting — so it cannot push the regenerated file. A
`workflow_run` workflow runs from the default branch with the repository's own
token, and can.

That leaves the harder half. `main` requires all six checks and its ruleset has
**no bypass actors**, so the commit this workflow pushes needs a green run of
its own — and a push made with `GITHUB_TOKEN` deliberately starts no workflow
run, or every bot commit would loop. The usual escape is a personal access
token to push with; there is none here, deliberately.

So CI gained a `workflow_dispatch` trigger. A dispatch is exempt from the
no-recursion rule, and a required status check cares which **commit** a check
ran on rather than what triggered it — so a dispatched run against the branch
satisfies the gate exactly as the original pull-request run would have. The
merge itself is left to auto-merge rather than waited on, so the job costs
seconds instead of an e2e run.

## What it will and will not merge

- **Everything except `notices` must have passed.** An update that fails a test
  is an update for a human. `notices` is the one it is allowed to fix.
- **The head commit must still be the one CI ran on**, found through
  `commits/{sha}/pulls` rather than the branch name. A branch that moved on is
  a run about a commit nobody is looking at.
- **The actor must be `dependabot[bot]`.** Anyone with push access can create a
  branch called `dependabot/…`, and this workflow merges what it is pointed at.
- **A `notices` failure with nothing to regenerate is an error, not a merge.**
  It means the job failed at something other than drift.
- Majors included. The gate is the same six checks either way, and one of them
  is a real e2e run against a real build.

## Two majors that cannot arrive alone

The same first run opened `vite@8`, `@vitejs/plugin-react@6`, `vitest@4` and
`@vitest/coverage-v8@4` as four pull requests, and all four failed at `npm ci`
with `ERESOLVE` — plugin-react 6 requires vite `^8`, and coverage-v8 pins its
vitest exactly. Four red runs pointing at nothing, which is the opposite of
what one-major-per-pull-request is for.

`vite` + `@vitejs/*` and `vitest` + `@vitest/*` are now groups. They sit below
the batch group, so a minor bump of any of them still arrives batched and only
a major reaches them. Taken together the four are green locally — typecheck,
Biome, 805 tests and a production build; vite 8 builds through rolldown, and
the warnings-are-errors handler survives it.

## The install never sees the write token

Regenerating means `npm ci`, which runs the install scripts of the very
packages being bumped. That happens in a job with `contents: read` which hands
the file over as an artifact; the job that can push and merge installs nothing
and runs only `git` and `gh`. The exposure is then the same as CI's, which has
been running those scripts under a read-only token all along.
