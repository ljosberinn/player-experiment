# 162 — Perf budgets count work, not time

`tests/perf.rs` failed the rust job intermittently: the genre seed took 2,045ms
to 56,715ms against a 2,000ms budget (637ms when passing), and the cold regroup
took 62,258ms against 60,000ms while holding the runner alone.

Every budget is now a count of what SQLite did — statements, VM steps, rows
full-scanned, sorts, commits — read through the trace and commit hooks. The
counts are identical across runs and machines, so the `RUNNER` lock is gone and
the play log fixture is 100k plays rather than 250k.

## Verification

- Rust job passes on repeated runs without re-running the job.
- Dropping `idx_tracks_artist` fails the sorted-page and deep-page budgets.
