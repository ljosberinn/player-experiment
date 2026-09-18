# 82n — The sweep line only arrives when the step parks

[82l](../done/82l-a-run-that-dies-with-the-sweep.md) put `run` on `pass.sweep`
so `OUTAGE` could be read back off it: "a `run` piling up at 7 means it is still
truncating." The line cannot answer, for a third reason after 82g's and 82l's.

**Parking is what ends a sweep, and `summary.run` is `max(plan.failures)`, so
`run` is only ever written at the moment it reached the threshold.** It cannot
be written above `OUTAGE` — parking ends the sweep — and it is not written below
it, because a sweep that has not parked has not written a line.

Thirteen `pass.sweep` lines on 2026-09-17, every one of them `run >= 7`: five
sweeps parked at exactly 7, and the eight probe sweeps behind them carried the
count on to 8, 9, 10, 11. Not one line below the threshold, in a day that ran
467 lookups.

The distribution below the threshold is exactly what is never written down, and
it is the only thing that would say whether 7 is the right number.

`failed`, `retries` and `visited` are lost the same way, and the process is
where they live: `plan.failures` is a field of `Plan`, so a restart before the
sweep ends drops the count as well. This log holds thirteen `db.open` lines in
thirteen days; 2026-09-17 alone restarted once mid-sweep, at 11:02:15, which is
why the 13:28 sweep opened at `run = 7` again after the 10:30 one had reached
11.

**The counters have to leave the sweep before the sweep does.** A `pass.progress`
line on a cadence — every *n* releases, or every *n* minutes — carrying
`visited`, `failed`, `retries` and `run`, and `pass.sweep` unchanged for the
end. The cadence has to be coarse enough not to write thousands of lines into a
file that rolls at 5MB ([86](../done/86-every-operation-in-a-logfile.md)): the
longest sweep in the day was 2h26m, and once
[82o](82o-a-503-is-the-one-failure-that-proves-the-service-answered.md) stops
declines from parking the step, a sweep runs to the end of the library instead —
about 90 sweep-hours at the observed ~45s a lookup.

Testing: a sweep asserted to write a progress line before it ends; the line
asserted to carry the run the counter has reached rather than the one it ended
on.
