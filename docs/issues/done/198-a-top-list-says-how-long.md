# 198 — A top list says how long

Top artists, albums, tracks and genres show plays only. Each row also shows,
faintly, the total time of its plays.

Play time is the sum of `DURATION` (`db/stats.rs`) over the row's plays, the
measure the Time spent tile uses: the track's length once per play, not time
actually listened. An imported scrobble has no length unless it matched a file.
So an unowned artist's row can have plays and no time.

## Backend

- `TopEntry` gets `duration_ms: i64` (a `number` in TypeScript) and
  `timed: u32`, as on `ListenTotals`.
- `top` also selects `coalesce(sum({DURATION}), 0), count({DURATION})`.
  Ranking stays by plays.
- `top_genres` adds both into its `HashMap`, now of `TopEntry`, along with
  plays.
- The ts-rs bindings carry both.

## Frontend

- `BarListEntry` gets an optional `detail?: string`, drawn as
  `.bar-list-detail` before `.bar-list-value`: tabular, `--muted` at 12px
  (`--faint` is ~2:1 on `--accent-fade`; 4e has no slot). Never wraps or
  shrinks; the label truncates first.
- `TopPanel` passes `formatSpan(durationMs)` as `detail` when `timed > 0`. A row
  with no timed plays gets no detail, not "0 minutes".
- A row timed only in part shows the time it has. The caption says "Time known
  for N% of these plays." when the drawn rows' `timed` falls short of their
  plays — counted over the rows, not `listen_totals`, which is the tile's and
  which genre rows (always matched) would contradict. Floored. On the genre
  panel it follows the genre coverage sentence.
- `HeardNeverOwned` stays as it is. Its plays have no file, so they have no
  time.

## Tests

- `stats.rs`: `top` sums known durations per group, counts `timed`, and leaves
  an unmatched scrobble's row at 0 / 0. `top_genres` sums across spellings that
  resolve to one label.
- `BarList`: a detail renders when given and is absent when not.
- `ListeningPanels`: no detail where `timed` is 0. The caption appears only when
  some drawn plays are untimed, and on the genre panel after the genre sentence.
- `App.css.test.ts`: `.bar-list-detail` is tabular.
- `BarList` story and the storybook fake carry details.

## Verification

- An artist that is fully owned shows a time close to its plays × track length.
- An artist heard only through last.fm shows plays and no time.
