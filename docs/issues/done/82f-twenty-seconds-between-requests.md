# 82f — Twenty seconds between MusicBrainz requests

[82e](82e-one-request-at-a-time.md) settled on ten. A pass over the real library
at ten spent an evening dying: thirty sweeps in `main.log`, every one of them
ending within seconds of a `lookup.release` line carrying HTTP 503, and several
releases — `Absu`, `Absztrakkt — Dein Zeichen` — taking four and five sweeps each
before one got past them.

`rate::INTERVAL` goes to twenty seconds.

## What the measurement did and did not cover

82e's numbers were 1.1s, 3s and 5s, and the releases reached before the first
fatal 503 — 72, 26, 35 — have no relationship to the interval. Ten was picked
from that as the least the pass could ask rather than as a rate expected to
work; twenty is the same argument over a range nothing has been measured at. It
may buy no more than ten did.

The cost is bounded and known: two calls a release, so roughly ninety hours for
eight thousand releases against forty-five, and an open lookup dialog waiting up
to twenty seconds behind the pass rather than ten. A pass measured in days is
already bounded by the interval, and a sweep that runs is worth more than one
that is quick to stop.

## Every MusicBrainz request goes through the gate

Audited rather than assumed, because the limiter is applied by callers and not
by the transport:

- `musicbrainz::search` and `musicbrainz::fetch` are the only two functions that
  reach `API_ROOT`, and both wrap the whole `transport.get` in
  `rate::shared().run`.
- Their three callers — the dialog's `tagsource_search`, the pass's search, and
  `tagsource::fetch_release` — go through no other path.
- `coverart::front` is outside the gate, deliberately: a different host with no
  rate limit, which is what lets a cover be fetched beside a tracklist instead
  of behind it.
- The limiter is a `static`, so the dialog and the background pass queue behind
  each other rather than each holding their own.

Testing: the interval is asserted from `INTERVAL` rather than a literal, so the
two limiter tests carry the new number by construction — and the slowest test in
the suite now costs twenty seconds of wall clock. The ambient gate every other
test passes through stays at 10 ms.
