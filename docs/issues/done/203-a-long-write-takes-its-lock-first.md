# 203 — A long write takes its lock first

```
15:05:13 ok  db.open         ms=360
15:05:13 err plays.refold    error=database error: database is locked
15:05:29 err scan.watch      error=database error: database is locked
```

This was the first launch of 0.23.0. Two things ran for the first time on it:
`refold_if_stale` (fold 8 → 9) and the full `plays::resolve` (`plays.resolved`
unset). Each failed in under a second, despite the 30s `busy_timeout`. The
same `scan.watch` failure appears on 09-29 14:13 and 15:48, and on 09-30 11:46.

The database is in WAL mode and every operation opens its own connection
(`Db::conn`). `refold` (a deferred `conn.transaction()`) and `resolve` (a bare
`SAVEPOINT`) read the whole play log before they write. SQLite gives a read
transaction's upgrade no busy handler. If another connection holds the write
lock at that moment, or has committed since the read, the upgrade fails at
once.

What it cost:

- `plays.matchFold` stays `8` until a launch's fold wins the race.
- The watch loop reset its clock before `try_acquire`, so a skipped pass
  waited a whole interval (15 min by default) instead of one tick.

## Shape

- `Db::conn()` sets `TransactionBehavior::Immediate`, so every
  `conn.transaction()` takes the write lock up front. No production
  transaction is read-only.
- `resolve`, `relink` and `regroup` go through `plays::atomically`: an
  IMMEDIATE transaction of their own when the connection is in autocommit,
  a savepoint of the caller's transaction otherwise.
- `busy_timeout` is set before the pragmas, so a busy `journal_mode` waits too.
- The watch loop resets its clock only once `try_acquire` succeeds. A failed
  pass still waits the interval: retrying every tick would walk the library
  every 15s on a persistent error.
- No retry in `plays-fold`. IMMEDIATE rules out the snapshot failure, and a
  plain busy now means a lock held past 30s. The marker stays unset on
  failure, so the next launch runs the fold again.
- `perf.rs`: a warm `regroup` commits its empty IMMEDIATE transaction. The
  budget allows one commit and asserts no rows changed.
- Tests: another connection holds the write lock for 300ms while
  `refold_if_stale`, and separately a bare `resolve`, runs. Both succeed.
