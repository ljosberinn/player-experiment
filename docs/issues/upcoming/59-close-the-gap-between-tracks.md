# 59 — Close the gap between tracks

A track ending and the next one starting leaves an audible ~125ms of silence,
worse on a cold file. Two independent costs, both in the player thread.

**Detection.** `TICK` (`audio/mod.rs`) is 250ms, and `Engine::tick` is the only
thing that asks `sink.finished()`. A track exhausts at a uniformly random point
in that interval, so the wait is 0-250ms; `rodio::Player::empty()` flips up to
50ms early because the mixer has already pulled that audio, leaving 0-200ms of
real silence, mean ~80ms. Always paid, warm or cold.

**Load.** `RodioSink::load` opens the file and builds the decoder
synchronously, and the engine is blocked for all of it. Measured over 674 files
of the library on the external USB volume: cold, album-sequential, mean 35ms /
p99 67ms; cold and random across the library, mean 51ms / p99 93ms / max 309ms.
Warm, the same files cost 0.17ms - so this is entirely first-read I/O, not
decoding. File size barely moves it (3.1 MB → 8.3ms, 12.4 MB → 14.1ms), so
embedded artwork is not the culprit and a format hint buys nothing.

## Adaptive tick

Poll fast near the end: 250ms normally, ~10ms once `duration_ms - position_ms`
is under a second. The thread's `recv_timeout` needs the interval from the
engine rather than a constant - `Engine::next_tick()`, say.

`TICK` is currently doing two jobs, and this splits them: at 10ms the
`Position` event would fire 100 times a second at the IPC. Position has to keep
its own 4/s cadence independent of the poll rate.

The fast window is keyed off the scanned duration, so a track whose
`duration_ms` is wrong never opens it and falls back to today's 250ms. Fine.

## Prefetch

Build the next decoder off-thread while the current track is still playing, so
`load` finds it ready.

Keep it inside the sink: `AudioSink` gains `fn prepare(&mut self, path:
&Path)`, which `RodioSink` services on a scratch thread and stashes; `load`
uses the stashed decoder when the path matches and builds synchronously when it
does not. `load`'s signature does not change, `FakeSink` and `SilentSink`
implement `prepare` as a no-op, and nothing existing needs rewriting.

Invalidation falls out of the path check - a queue edit, a skip, or repeat
being toggled just means the prepared decoder is not the one asked for. Nothing
to track.

Trigger it from `tick` beside `announce_if_due` and `count_play_if_due`, a few
seconds out so the 309ms tail is covered, at most once per load, and not past
the end of the queue.

## Notes

Testable without a sound card: `FakeSink` records `prepare` calls, so the
trigger conditions are assertable, as is `next_tick()` shortening near the end
and `Position` holding 4/s while the poll runs at 10ms. The timing itself is
not - CI has no clock worth trusting for 10ms.

This gets the join to roughly 10ms. It is not gapless playback, and the entry
in [limitations.md](../../knowledge/limitations.md) stays: appending the next
decoder to the same `rodio::Player` is what makes it sample-accurate, and that
costs the one-Player-per-track design the engine relies on for `finished()`.
