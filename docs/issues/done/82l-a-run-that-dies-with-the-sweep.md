# 82l — A run that dies with the sweep counts nothing

`OUTAGE = 3` was picked without a number to draw it from —
[82g](../done/82g-a-503-defers-the-release.md) said so, and said to read it back
off the sweep line. The line cannot answer, for the same reason it could not
then.

**2026-09-16, 13:13–16:08: 177 lookups, 124 reaching a verdict, 53 failing
outright. All seven sweeps ended parked.**

| ended | visited | failed | logged run at end |
|---|---|---|---|
| 14:47:59 | 174 | 24 | 3 |
| 15:10:34 | 127 | 9 | 3 |
| 15:14:35 | 77 | 3 | 3 |
| 15:18:54 | **16** | 3 | 3 |
| 15:43:29 | 94 | 5 | 3 |
| 16:04:53 | 105 | 5 | **5** |
| 16:07:51 | **13** | 3 | 3 |

## The log's runs are not the counter's

Two holes, both visible above:

- `failures` is a local of `sweep`. Parking ends the sweep's lookups, so no run
  inside one sweep can pass `OUTAGE`, and every longer run the log holds —
  4, 6, 8 over this window — is two or three parkings end to end.
- `Verdict::NotFound` resets the run and writes no line. The run of five at
  16:04:53 is a number the counter cannot reach.

Both overstate, so a histogram read off the log measures the threshold rather
than the network. Raising the constant off it is 82g's mistake with a bigger
number.

## What the line does say

53 of 177 lookups failed — 30%, one lookup a minute at the throttle's pace.
Three in a row is expected every 53 lookups on that rate alone. Seven sweeps in
three hours is what that looks like: the threshold is tripping on the ordinary
rate.

A parked sweep has only placement work left, drains it, and ends — 13 releases
against the 8,008 in the library. `Pace::begin` then opens the next sweep's
readout at nothing, which is what it is for, but the fraction it reopens on is a
pass that got three minutes.

## The run has to outlive the sweep

Worse than a threshold set too low: a sweep-scoped run cannot detect an outage
at all. Every sweep opens the count at zero, and `next_sweep` returns `TICK`
while there is placement work to do, so a network that is down is asked again
fifteen seconds later — three more failed lookups, nine more requests, and
again. The backstop written to stop 8,044 releases going through three attempts
each spends them at a slower rate instead.

**`failures` onto `Plan`, beside `pace` and `rehearsed`, for the reason given
there: what the sweep learned must not die with a sweep that ended early.**
`hobbled` stays a local, so each sweep probes once — one verdict clears the run,
one failure re-parks it, and an outage costs one lookup a sweep rather than
three.

## The number

Not off the distribution, which cannot be read. Off the two costs. A park that
comes late costs `OUTAGE` × 3 throttled requests — seven minutes at seven. A
park that comes early costs the rest of one sweep's lookups and a readout
reopened on a stub. Both are cheap, so the number is whichever the ordinary rate
does not reach: expected runs of at least *k* in 177 lookups at p=0.3 are 3.3 at
three, 0.30 at five, 0.027 at seven. Parkings ran at twice the count for three,
so declines cluster and these are floors.

***`OUTAGE` to 7.***

**And the run onto the sweep line**, as `run` — the longest the counter reached.
`failed` counts failures, not runs, and the run is what the threshold is. Read
it back after a week; a `run` piling up at 7 means it is still truncating.

Testing: the existing run-parks-the-step test carries `OUTAGE` rather than a
literal, so it moves with the constant; add one asserting a run one short of the
threshold leaves the step on, one asserting a run carried across sweeps parks
the next sweep on its first failure, and one asserting a verdict clears it.
