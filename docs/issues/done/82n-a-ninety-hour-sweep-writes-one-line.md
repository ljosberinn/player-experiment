# 82n — A ninety-hour sweep writes one line, at the end

[82l](82l-a-run-that-dies-with-the-sweep.md) put `run` on `pass.sweep` so
`OUTAGE` could be read back off it: "a `run` piling up at 7 means it is still
truncating." Thirteen `pass.sweep` lines on 2026-09-17, every one of them
`run >= 7`: five sweeps parked at exactly 7, and the eight probe sweeps behind
them carried the count on to 8, 9, 10, 11. Not one line below the threshold, in
a day that ran 467 lookups.

**Not because the line cannot carry a lower number.** `sweep` returns on an
empty survey and on both switches going off as well, and a sweep of six declines
writes `run=6` today. It is that 8,008 releases is more work than seven failures
away, so parking is the only ending this library reaches.

And the distribution it censors is no longer worth recovering:
[82o](../upcoming/82o-a-503-is-the-one-failure-that-proves-the-service-answered.md)
takes the threshold off the one error that cannot mean an outage, and a
transport error needs no distribution behind it.

## What survives is whether the line arrives at all

`visited`, `failed`, `retries` and `run` are fields of a `Summary` built per
sweep, and `plan.failures` is a field of `Plan`, which is a local of the pass
thread. A process that dies mid-sweep takes all five with it. This log holds
thirteen `db.open` lines in thirteen days; 2026-09-17 alone restarted once
mid-sweep, at 11:02:15, which is why the 13:28 sweep opened at `run = 7` again
after the 10:30 one had reached 11.

A sweep parks after forty to ninety minutes today, so the line lands anyway.
**82o and [82p](../upcoming/82p-the-deferred-tail-has-no-bound.md) both end
that**: a sweep runs to the end of the library instead — about 90 sweep-hours at
the observed ~45s a lookup — against a process restarted about daily. The line
stops arriving.

**The counters have to leave the sweep before the sweep does.** A `pass.progress`
line on a cadence carrying `visited`, `failed`, `retries` and `run`, with
`pass.sweep` unchanged for the end.

## Every *n* releases, not every *n* minutes

Releases bound the file and minutes do not: one line per *n* releases is at most
8,008/*n* a pass whatever the pace — eighty at a hundred — and an idle sweep
gets through nothing and writes nothing. A minute cadence is spent against the
90 sweep-hours instead, into a file that rolls at 5MB
([86](86-every-operation-in-a-logfile.md)).

Counted on releases the sweep got through, **not on `visited`**: a release whose
lookup failed returns an error rather than an outcome and is not counted there,
so a `visited` cadence would go quiet during exactly the failure the line exists
to record. The tail counts on the same number, because after 82p it is thousands
of releases long.

The cadence sits on `Plan` beside `batch`, and for the same reason: a test has
to reach a second line without a library of a hundred releases.

`Log::note` rather than `Log::op` — `Op` measures `ms` from the moment it is
created, so every progress line would carry `ms=0`, and `note` is already what
a line about something that happened elsewhere uses.

Testing: a sweep asserted to write a progress line before it ends; the line
asserted to carry the run the counter had reached when it was written rather
than the one the sweep ended on; a sweep whose lookups all fail asserted to
write one at all.
