# Profiling the backend

`main.log` says how long an operation took (`ms=`). A trace says where the
time went: wall-clock spans, one lane per thread, opened in
[Perfetto](https://ui.perfetto.dev).

## Two ways in

```sh
# The scan the app would run next, headless, twice over a snapshot:
cd src-tauri
cargo run --release --features profile --example profile_scan [path/to/library.sqlite3]

# Anything else - a tag write, a lookup, a move - in the running app:
npm run dev:profile
```

`profile_scan` backs up the library (default: the installed app's) into
`%TEMP%/apex-profile/` with SQLite's backup API, which is safe while the app
has it open, then scans the copy twice. The music files are walked and read,
never written. The trace lands beside the copy.

`dev:profile` is `tauri dev --release --features profile` against the real
library. The trace is written beside `main.log` as `trace-<unix seconds>.json`
and closed when the app quits; quit it rather than killing it, or the tail of
the trace is lost.

Both need `--release`. A debug build compiles SQLite and lofty unoptimized,
which moves every CPU-bound span and none of the disk-bound ones.

## Cold and warm

The first `scan.watch` after the machine has been idle takes 40-50s; the same
no-op scan minutes later takes 1.3s. Nothing in the library differs between
the two, so the disk does: the suspects are `scan.walk` stating 66k files and
`tags.read` on the unreadable ones below. To trace it, reboot and run
`profile_scan` before anything else touches the library folders. Its second
pass is always warm.

## Why spans, not a sampler

The slow cases are waits. A cold walk waits on the disk, the lookup pass sleeps
out its rate limit (1.5s per request, `tagsource::rate`), and a mover waits on
`scan_lock.wait`. A CPU sampler such as `samply` records none of that, and on
Windows it needs an elevated shell for ETW besides. It is still the tool for
what happens *inside* a span that is busy on the CPU - lofty parsing a file,
SQLite running a statement - on a release build with `debug = true`.

`tracing-chrome` over `tracing-flame`: the flame graph folds every thread into
one stack, so 32 rayon workers reading tags in parallel become one bar 32
times too long. The Chrome trace keeps them as lanes.

Tauri's own `tracing` feature is not enabled: it instruments IPC and the event
loop, and the slow work runs on its own threads, outside both.

## Adding a span

```rust
span!("scan.walk");
span!("tags.read", path = %path.display());
```

Crate-internal, defined at the top of `lib.rs`. It is a statement that lasts to
the end of its block, and without the feature it expands to nothing, so a
shipped build carries no `tracing`. Name spans like `main.log` names
operations. Put them where the time is spent, not on every function: a span per
file on 65k files is fine, a span per SQL row is not.

What is instrumented: the scan (`scan.walk`, `scan.load_known`, `scan.plan`,
`scan.read_tags` with a `tags.read` per file, `scan.write`,
`scan.mark_missing`), the three whole-library passes a scan and a tag write
both end with (`tag_values.rebuild`, `plays.count`, and `plays.resolve` with
one child per tier: `keys`, `albums`, `near`, `update`), a tag
write (`tags.write`, `tags.write_file`, `tags.sync`), a move
(`library.move_release`), and every wait on the scan lock.

## What a warm scan of the real library shows

65,882 tracks, three roots, nothing changed, 1.5s:

| Span | ms |
| --- | --- |
| `plays.resolve` | 950 |
| `scan.walk` | 280 |
| `tag_values.rebuild` | 110 |
| `scan.load_known` + `scan.plan` | 135 |
| `scan.read_tags` (141 unreadable files) | 2 warm, 1270 cold |

`plays.resolve` relinks all 237k plays whether or not a track changed, and a
tag write pays it too. Building the keys from 66k tracks is ~400ms of it; the
album and near-title tiers ~440ms together, spent on the 59k plays that never
link. The 141 unreadable files have no row, so every scan
plans them as new and parses them again; cold, a single one takes over a
second.
