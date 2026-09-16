# 82l — Three declines is a burst, not an outage

`OUTAGE = 3` was picked without a number to draw it from —
[82g](../done/82g-a-503-defers-the-release.md) said so, and said to read it back
off the sweep line. The line now answers.

**2026-09-16: 165 lookups, 121 reaching a verdict, 44 failing outright. A 27%
decline rate.** Consecutive-failure runs over that day:

```
length  1  2  3  4  6
count   8 10  2  1  1
```

Four runs reached three and parked the lookup step for the rest of their sweep.
At p=0.27 a run of three is expected about three times in 165 requests, which is
what the count shows: the threshold is tripping on the ordinary rate, not on an
outage. Nothing reached five but once, and nothing reached seven.

The five sweeps that finished in that window, four of them on a parked step:

| ended | visited | failed |
|---|---|---|
| 14:47:59 | 174 | 24 |
| 15:10:34 | 127 | 9 |
| 15:14:35 | 77 | 3 |
| 15:18:54 | **16** | 3 |
| 15:43:29 | 94 | 5 |

A parked sweep has only placement work left, drains it, and ends — 16 releases
against the 8,008 in the library. `Pace::begin` then opens the next sweep's
readout at nothing, which is what it is for, but the fraction it reopens on is a
pass that got four minutes.

***`OUTAGE` to 7.*** Six is the longest run this log holds and seven is where the
expected count over a day of requests falls below one. Read it back off the
sweep line again after a week.

Both counts this rests on are already on the line, so nothing new has to be
logged for the next reading.

Testing: the existing run-parks-the-step test carries `OUTAGE` rather than a
literal, so it moves with the constant; add one asserting a run one short of the
threshold leaves the step on.
