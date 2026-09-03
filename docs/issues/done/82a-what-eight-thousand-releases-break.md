# 82a — What eight thousand releases break

A defect [82b](../upcoming/82b-the-unattended-lookup-pass.md) would walk straight into,
invisible at the ten releases a hand-driven lookup does. Independent of the
pass, so it lands first and alone.

The undo journal was this phase's other half. Bounding it was abandoned before
it shipped; the journal comes out instead, in the reopened
[82a](../upcoming/82a-what-eight-thousand-releases-break.md).

## `library://changed` is a re-query per release

[62](62-one-invalidation-channel.md) debounces both subscribers at
`INVALIDATE_DEBOUNCE_MS`, 250ms, and that window was tuned for a burst — a scan
committing in a tight loop. A lookup pass commits one release roughly every two
seconds for four and a half hours, which is wider than the window, so **every
ping fires a full re-query of the open view and a playlist recount**. 8,044 of
them. Debouncing harder in the frontend is the wrong end: the events are already
isolated by the time they arrive.

So it coalesces on the emit side, in `announcing`/`announcing_with` — one place,
which means every long write after this one inherits it, [83b](../upcoming/83b-moving-one-release.md)
included. Two constraints on the window:

- **Trailing edge, always.** A leading-edge throttle drops the final ping and
  leaves the view one release behind for as long as it stays open.
- **Seconds, not milliseconds.** The frontend debounce still runs underneath,
  so the two compose; the backend window is what decides how stale the view is
  allowed to be during a long pass.

*Settled:* **5s, and the leading edge is kept.** "Trailing edge, always" is
read as "the trailing ping must always fire", not "never fire on the leading
edge" — a trailing-only throttle would put the whole window in front of every
ordinary edit, and 62 already called the frontend's 250ms the one visible
behaviour change. So an isolated write is announced at once, and a run is
announced once per window, the trailing ping opening the next window rather
than leaving the next writer to take a leading edge.

5s because the range's low end buys nothing: the pass commits about every 2s,
so a 2s window coalesces roughly nothing and 3s takes 8,044 pings to ~5,400,
where 5s takes them to ~3,200. Provisional until 82b exists to measure against.
