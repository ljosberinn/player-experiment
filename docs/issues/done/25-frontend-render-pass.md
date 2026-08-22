# 25 — Frontend render pass

Merged in #38.

Three store values changed on schedules of their own and were all read at the top
of `App`, so each re-rendered the whole tree — the table and its forty virtualized
rows included.

| What | How often | Table renders before | After |
| --- | --- | --- | --- |
| `positionMs` | every 250ms while playing | 960 per four-minute track | 0 |
| `volume` | every pointer move during a drag | 50 per 50-sample drag | 0 |
| `searchInput` | every keystroke | 5 per five-letter word | 0 |

Each moved into a component that subscribes on its own behalf —
`NowPlayingStatus`, `PlayerTransport`, `SearchBox`. The volume case was not
predicted: the slider reports with `onValueChange` deliberately, so it writes at
the pointer's sampling rate, faster than the audio thread ticks.

`App.renders.test.tsx` **counts** renders rather than timing them — exact, where a
wall-clock budget on a CI runner is noise.

**File splitting is not the lever; where the subscription lives is.**
`memo(SongTable)` was deliberately not taken: nothing left in `App` changes often
enough, the table subscribes to the selection itself, and `memo` would first need
`resolveColumns` memoized and four callbacks stabilized or it never hits.
