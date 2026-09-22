# 123 — The queue past the first note

`e2e/specs/playback.test.ts` drives the transport with a queue behind it.
Before it, `library.test.ts` starting a track and reading the row marker was
the whole of playback in the suite.

**What is covered.** Next and Previous moving `queueIndex` and the status
display with it, Previous restarting the track once past the three-second
grace, a track ending and the next one starting unasked, repeat-one replaying
the same row, Play becoming Pause, and the scrubber moving `positionMs` in both
directions. Asserted against `player_snapshot`, which is what "the queue moved"
means; the title is read where a user would see it.

**A track can now end on purpose.** `SilentSink` never reports itself finished
while something is loaded — deliberately, or a sink that ran out would advance
the queue underneath whatever spec was asserting on it. That made the two
behaviours a user only ever sees at a track's end unreachable from a driver.
`e2e_end_track` is the route, behind `e2e_only` like the seeds; the engine
handles it with the same code `tick` reaches when the sink says the track is
over, so the sink's own end detection is all that stays with the Rust tests.

**The grace period is set, not waited out.** Three seconds in, Previous
restarts the track rather than stepping back (`PREVIOUS_RESTART_AFTER`). A
driver racing the wall clock across that line passes or fails on how busy the
runner is, so the position is seeked to either side of it and both outcomes are
asserted.

**Paused, for the scrubber.** `SilentSink` advances position on a wall clock,
so against a playing track "the position went up" is true whether or not the
seek arrived. Pausing first is what makes it an assertion. A focused rail owns
the arrows (`targetOwns`), so the keypress is one seek and not two — the other
side of the rule `shortcuts.test.ts` drives from the search box.

**Row order is read, not sorted.** Every assertion is "the row after this one",
which holds in whatever order the spec before it left — and a sort of its own
would be one more thing to put back.

**Where it runs.** After `logfile.test.ts` and before `dynamic-background`,
which plays its own tracks: late enough that the specs photographing the app
are not handed a transport in whatever state a queue test left it, and before
`virtualization`, whose synthetic rows name paths no sink can open. It stops
the player and turns repeat off, which is what `shortcuts.test.ts` already
hands on.

**`library-drop.test.ts` had never run.** Added in #204, never added to
`wdio.conf.ts`'s `specs` array, which is listed rather than globbed. It is in
the array now, after `row-drag`.

`playRow` moved to `e2e/playback.ts` with the snapshot and the diagnostic it
fails with; `library.test.ts` imports it.

**Not in scope.** Everything else in
[123](../upcoming/123-e2e-coverage-gaps.md).
