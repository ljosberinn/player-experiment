# 82o — A 503 is the one failure that proves the service answered

`OUTAGE` exists for the case [82g](../done/82g-a-503-defers-the-release.md)
named: "a network that is down defers all 8,044 releases and then spends three
attempts on each of them in the tail." **That condition has never appeared in
this log.** All 124 lookup and tagsource failures on 2026-09-17, and every one
of the 66 before it, are `musicbrainz.org answered with HTTP 503` — not once a
connect, DNS or transport error.

A 503 is the service replying. `rate.rs` already records why it says nothing:
MusicBrainz declines from three buckets — per user agent, per address, and a
global 300 a second — "so a client well inside its own allowance still meets
503s when theirs is full, and the status code cannot tell the two apart."

**The backstop counts the one error that cannot mean what it is counting.**

## The threshold is not high, it is the wrong shape

The rate is not the problem. Over the whole of 2026-09-17: 467 lookups — 204
written, 55 queued, 85 `NotFound`, 123 declined. 26%, under
[82l](../done/82l-a-run-that-dies-with-the-sweep.md)'s 30%.

The threshold was reached five times anyway, in six hours: every sweep that ran
long enough to do lookups parked at exactly `run = 7`.

```
10:26:13  13:28:28  13:40:03  14:28:30  15:19:19
```

At 26% over 467 lookups, a run of seven should appear 0.04 times. It appeared
five, better than a hundredfold over. Declines do not arrive independently,
because a refilling bucket is not a coin — and no threshold does better against
a burst, because the thing being counted is the rate limiter working.

(The sub-threshold run lengths cannot be read off the log to go with this: a
`NotFound` resets the run and writes no line, so runs counted off
`lookup.release` are longer than the ones the sweep saw — the same censoring
[82n](82n-the-sweep-line-only-arrives-when-the-step-parks.md) is about. The five
parks are the sweep's own count and are not affected.)

82l raised 82g's number because the number was the wrong instrument; 7 is the
same mistake one step further out.

**The run counts failures the service did not answer.** A transport error is
unambiguous and needs no distribution behind it, so the threshold goes back down
— two or three — and stops being a number anyone has to read back. A 503 still
defers the release to the tail and still counts in `failed`; it never touches
`run`.

What this does not fix: a third of a pass is still spent on requests that are
declined. It also removes the only thing bounding the tail today — sweeps park
after forty to ninety minutes, so nothing has yet grown a deferred list past 2.
Once they run to exhaustion, [82p](82p-the-deferred-tail-has-no-bound.md) is
what happens, and it wants landing alongside this.

The transport already tells them apart — `TransportError::Unreachable` against
`TransportError::Server { status }`, carried through `AppError::Network`. What
throws it away is `Err(_)` in `visit`'s verdict match, which is also where a
database write failing during a lookup is counted as a decline.

Testing: a run of declines asserted to leave the step on however long it runs; a
run of transport errors asserted to park it at the threshold; a decline asserted
to count in `failed` and not in `run`.
