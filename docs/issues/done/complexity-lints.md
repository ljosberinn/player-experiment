# Complexity lints on both halves

Biome and clippy both run everywhere already — pre-commit, pre-push, CI — but
neither is asked about function complexity, so a function can grow without
anything objecting.

Neither tool offers cyclomatic complexity. Both offer cognitive complexity, the
Sonar variant that charges for nesting rather than counting branches, which is
the closer measure of what makes a function hard to read.

- `complexity/noExcessiveCognitiveComplexity` at `error` in `biome.json`, at its
  default `maxAllowedComplexity` of 15. It is off by default and `info` when on.
- `clippy::cognitive_complexity` at `deny` in `[lints.clippy]`. It is a nursery
  lint, so allow-by-default, but stable clippy carries it. Its threshold lives in
  a `clippy.toml` (`cognitive-complexity-threshold`), which the repository does
  not have yet; clippy's own default is 25, set it to 15 so both halves fail at
  the same point.

The rules land green or not at all: whatever they flag gets refactored, not
suppressed per file. That is the actual size of this issue — the config is four
lines and the offenders are the work.

## What they flagged

One Rust function and eleven TypeScript ones. Nothing was suppressed.

- `tags/write.rs`'s `mutate` gave up the cover branch to `set_cover`, and
  `tests/scan.rs`'s one ingest test became four — an `assert` is a branch, so a
  test that asserts twenty things scores like a function that does.
- `App.tsx` was 59. It is now the composition: `LibraryPane`, `StatusBar`,
  `useAppMenus`, `AppErrorPopover` and a host component per dialog, each
  reading the stores it needs (see [frontend](../../knowledge/frontend.md)).
- `SongTable`'s rows became `SongRow`, and its window-level keys `tableKey`;
  `useSelectionShortcuts` became one function per chord, each answering whether
  the key was its own.
- The e2e colour probes moved out of the `describe` nesting to module level,
  which is also where `library.test.ts`'s `colours()` already was. They stay
  written out per spec: `browser.execute` ships the one function it is given,
  so a page-side helper cannot be imported.
