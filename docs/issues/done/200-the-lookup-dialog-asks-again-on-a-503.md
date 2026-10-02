# 200 — The lookup dialog asks again on a 503

```
12:45:13 err tagsource.search album=RAT WARS ULTRA EDITION artist=HEALTH error=musicbrainz.org answered with HTTP 503
12:45:15 ok  tagsource.search album=RAT WARS ULTRA EDITION artist=HEALTH candidates=1 ms=642
```

The second line is the user pressing Search again. `tagsource_search` and
`tagsource_fetch` called MusicBrainz once and handed a 503 to the dialog. Only
the pass retried.

## Shape

- `retrying` moves from `pass.rs` to `tagsource/mod.rs`, along with the `Flaky`
  test transport (now wrapping any `FakeTransport`). The caller passes the
  predicate.
  - The pass keeps `AppError::transient`.
  - The dialog retries only `AppError::declined` — a 503, the rule from 82o,
    moved off `worker.rs` onto `AppError`.
  - Anything else goes to the dialog at once. `transient()` also covers every
    other non-404 status and `Unreachable`, and three 15s timeouts would keep
    the dialog on "Searching…" for about 48s.
- The spacing stays with the limiter (1.5s, `rate.rs`). `retrying` doesn't
  wait on its own.
- `retries=` on the dialog's `tagsource.search` and `tagsource.fetch` lines,
  when there were any (82e), on failure lines too.
  - `Op::failed_with` carries fields onto a failure line.
  - `pass::look_up` takes the counter instead of returning it, so a lookup that
    ran out still logs its retries and counts them in the sweep's `retries=`.
- `ReleaseLookup.tsx`: when `error` is set, the pane shows neither "No match on
  MusicBrainz…" nor "Pick the release these files came from."
- `store.ts`: `enter`, `search` and `pick` each take a request number, and a
  result — success or failure — lands only if nothing was asked after it.
  `back` and `close` bump it too. A second search or pick on the same release
  passes any check on the entry, and with retries the first can come back last.
- Stale interval wording (1.5s since 104; the pass now takes hours, not days)
  in `src`, `src-tauri/src`, `e2e` and `docs/knowledge`.
  - History left alone: `rate.rs:30`, `architecture.md:308`.
- Docs: `limitations.md` and `architecture.md` describe the dialog's retries.
