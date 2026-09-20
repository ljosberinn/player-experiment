# 104 — The limiter goes back to the documented rate

`rate::INTERVAL` goes from twenty seconds to 1.5s.

[82e](done/82e-one-request-at-a-time.md) measured 1.1s, 3s and 5s: releases
reached before the first fatal 503 were 72, 26 and 35 — no relationship, which
is why the declines are theirs rather than ours. Ten was then picked past the
end of that measurement, and [82f](done/82f-twenty-seconds-between-requests.md)
doubled it twice more on the same argument. Neither number was ever measured,
and 82f said outright it might buy nothing over ten. It did not: the 503s come
from buckets the interval cannot reach, and the retry is what absorbs them.

1.5s is a little over the one a second
[MusicBrainz documents](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting).

## What it changes

Nothing about the shape of the pass — only the number attached to it:

- A first pass over eight thousand releases is about seven hours rather than
  ninety, at two calls a release.
- An open lookup dialog waits up to 1.5s behind the pass rather than twenty
  seconds.
- The review queue's candidate cache saves 1.5s an entry rather than twenty,
  so four hundred entries is ten minutes of waiting rather than most of a day.
- `two_callers_serialize_against_each_other` asserts at `INTERVAL` and so pays
  1.5s instead of twenty. It is no longer the slowest test in the suite.

Every prose reference to the old number moves with it: `commands`, `db::lookup`,
`db::query`, `model`, `library::worker`, `lib`, `tagsource::pass`, and the
architecture, frontend, limitations and testing knowledge docs.

`lastfm::transport::TIMEOUT` is also twenty seconds and is unrelated; the
comment in `tagsource::transport` that compares against it still holds.
