# 82o — A 503 is the one failure that proves the service answered

`OUTAGE` exists for the case [82g](82g-a-503-defers-the-release.md) named: "a
network that is down defers all 8,044 releases and then spends three attempts on
each of them in the tail." **That condition has never appeared in this log.**
All 213 transport failures in it are `answered with HTTP 503` — not once a
connect, DNS or transport error. All 209 of them that reached a lookup are 503
too: no database or parse failure has ever reached that arm either.

A 503 is the service replying. `rate.rs` already records why it says nothing:
MusicBrainz declines from three buckets — per user agent, per address, and a
global 300 a second — "so a client well inside its own allowance still meets
503s when theirs is full, and the status code cannot tell the two apart."

**The backstop counts the one error that cannot mean what it is counting.**

## The threshold is not high, it is the wrong shape

The rate is not the problem. Over 2026-09-17: 424 lookups reaching the log —
219 written, 62 queued, 143 declined — against 85 `NotFound`, which writes no
line. Under [82l](82l-a-run-that-dies-with-the-sweep.md)'s 30%.

The threshold was reached six times anyway, between 10:26 and 16:14: every sweep
that ran long enough to do lookups parked at exactly `run = 7`.

```
10:26:13  13:28:28  13:40:03  14:28:30  15:19:19  16:13:41
```

At that rate a run of seven should appear about 0.04 times. Declines do not
arrive independently, because a refilling bucket is not a coin — and no
threshold does better against a burst, because the thing being counted is the
rate limiter working. 2026-09-18 is the same shape from the other side: 158
visited, 13 failed, `run` peaked at 3.

(The sub-threshold run lengths cannot be read off the log to go with this: a
`NotFound` resets the run and writes no line, so runs counted off
`lookup.release` are longer than the ones the sweep saw — the same censoring
[82n](82n-a-ninety-hour-sweep-writes-one-line.md) is about. The parks are the
sweep's own count and are not affected.)

82l raised 82g's number because the number was the wrong instrument; 7 is the
same mistake one step further out.

## A park is not paid once

82l put the run on `Plan` so it would outlive the sweep. It does, so a park
outlives it too — each following sweep spends its one probe on three more
declined requests and parks again:

```
10:26:13  run=7   visited=105  ms=2403726
10:27:11  run=8   visited=15   ms=43059
10:28:11  run=9   10:29:11 run=10   10:30:11 run=11
```

What cleared it was the 11:02 restart — `Plan` dies with the process — which is
[82p](../upcoming/82p-the-deferred-tail-has-no-bound.md)'s restart. The minutes
are small. The instrument is the problem: the counter cannot detect the one
thing it exists for, and fires steadily on a non-event.

## Only a 503

**The run counts failures the service did not answer**, and nothing else is
ambiguous enough to need a distribution behind it, so the threshold goes back
down to three and stops being a number anyone has to read back. Three releases
each exhausting three attempts is nine consecutive unanswered requests over
three minutes, which is 82g's arithmetic — it was never wrong about the number,
only about what it was counting.

*Only a 503, not every `TransportError::Server`.* That variant also covers "a
gateway, a captive portal, a 5xx page" by its own doc, and a proxy answering 502
forever would never park — 8,044 releases through three attempts each, exactly
what the backstop is for. 503 is the documented code for a full bucket and the
only status that says MusicBrainz itself replied.

*Everything else counts*, including the database error that `Err(_)` in `visit`
currently files as a decline. The test is whether the failure says anything
about the next release, and a locked database says as much as an unreachable
host.

*A 503 neither counts nor clears.* It is evidence the path is up, but `Server`
is wider than MusicBrainz and a flapping network would alternate, so clearing on
one would make an outage undetectable. A 503 still defers the release to the
tail and still counts in `failed`; it never touches `run`.

The transport already tells them apart — `TransportError::Unreachable` against
`TransportError::Server { status }`, carried through `AppError::Network`.

What this does not fix: a third of a pass is still spent on requests that are
declined. It also removes the only thing bounding the tail today — sweeps park
after forty to ninety minutes, so nothing has yet grown a deferred list past 2.
Once they run to exhaustion,
[82p](../upcoming/82p-the-deferred-tail-has-no-bound.md) is what happens, and it
wants landing alongside this.

Testing: a run of declines asserted to leave the step on however long it runs; a
run of transport errors asserted to park it at the threshold; a 502 asserted to
park it; a decline asserted to count in `failed` and not in `run`, and not to
clear a run it lands in the middle of.
