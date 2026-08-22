# 46 — The notices are generated, not committed

Phase 45 built machinery to regenerate `THIRD-PARTY-NOTICES.md` on Dependabot's
behalf, because the drift check on that file failed on every dependency update
by construction. The machinery worked and the first update landed through it.
It also cost a push to the bot's branch, and that push turned out to park a
`pull_request` run at `action_required` — which blocks the merge by itself,
however green everything else is, until somebody approves it by hand.

At which point the better question was why a 655 kB derived file is in the
repository at all.

Nothing reads it. Nothing imports it. It is listed in `tauri.conf.json` as a
bundle resource next to `LICENSE`, and the only reason it was committed is that
the build expected to find it on disk. So `beforeBuildCommand` generates it
instead, and the file is gitignored.

That is **stronger**, not weaker, on the thing the file exists for: a bundle now
carries notices for the graph that bundle is shipping, rather than for whatever
graph somebody last remembered to regenerate against.

## What the `notices` job checks now

The job keeps its name — the ruleset requires a context called `notices` and has
no bypass actors, so deleting the job would leave that context unreported and
every pull request blocked forever — and changes what it asserts. It runs the
generator and throws the result away.

That is not a nothing-check. It catches what can still go wrong: a dependency
arriving with no licence file, or the tool that lists them failing in a way that
reads as "no dependencies" — which has happened once and shipped a notices file
with **zero** npm packages in it. Finding that out during a release build is
finding it out too late. What it can no longer do is fail merely because a
dependency moved.

## Decisions

**The generator short-circuits on mtime.** `beforeBuildCommand` runs before
`tauri dev` as well as before a bundle, and reading three hundred crate
manifests on every dev start is a wait for an answer that has not changed. If
the output is newer than both `package-lock.json` and `src-tauri/Cargo.lock`,
it exits. `--force` skips the question; CI passes it, and a release build gets
it via a fresh checkout where the file does not exist at all.

**Both lockfiles, because either ecosystem moving invalidates the file.**

**`--check` is gone**, along with `npm run notices:check`. There is no committed
file to compare against.

**npm licence changes no longer appear in a diff.** `cargo-deny check licenses`
still gates the Rust side; the npm side has no equivalent. The honest reading is
that this signal was already theoretical — it arrived as a 655 kB diff nobody
reads — and that buying it back means committing a manifest that churns on every
update, which is the thing being removed. If it is ever wanted, it should be
names and SPDX ids, not licence texts.

**Output is byte-identical to what was committed**: `git hash-object` on the
generated file matches the blob this phase deletes.
