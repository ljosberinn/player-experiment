# 191 — A flamegraph of the backend

When a scan, a tag write or a move is slow, nothing shows where the time goes:
`main.log` has one `ms=` per operation, not a breakdown.

`main.log` stays as it is. It does not become a `tracing` subscriber, and
release builds carry none of this ([86](86-every-operation-in-a-logfile.md)).

## Spans, not a sampler

The slow cases are waits: a no-op `scan.watch` takes 42-48s after the machine
has been idle and 1.3s otherwise, and the lookup pass sleeps 1.5s per request
(`tagsource::rate`). A CPU sampler sees neither, and `samply` on Windows needs
an elevated shell. So a `profile` Cargo feature, gated like `wdio`: `tracing`
and `tracing-chrome`, whose trace keeps each rayon worker as its own lane in
Perfetto where `tracing-flame` would fold them into one stack.

- `span!`, a statement macro in `lib.rs` that expands to nothing without the
  feature.
- Spans on the scan's phases, per-file tag reads, the whole-library passes a
  scan and a tag write end with, a tag write, a move, and the scan lock.
- `examples/profile_scan.rs`: two scans over a SQLite backup of the real
  library, headless. `npm run dev:profile` traces the running app.
- A second clippy run in CI with the feature on.
- Not Tauri's `tracing` feature: the slow work runs on its own threads,
  outside IPC.

## Outcome

[profiling.md](../../knowledge/profiling.md), and a warm trace of the real
library: 65,882 tracks, 1.5s, of which `plays.resolve` is 950ms. Follow-ups:
193 (skip the whole-library passes when a scan changed nothing), 194 (stop
re-reading unreadable files). The cold trace needs a reboot first.
