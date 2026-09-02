# 68 — Changing the default output device orphans playback

Switch the Windows default output device while a track is playing and the sound
does not follow. `RodioSink::open` calls
`DeviceSinkBuilder::open_default_sink()` once, at startup, and the
`MixerDeviceSink` it returns is held for the life of the player thread
(`sink.rs`). Nothing ever asks the OS whether the default changed, so the cpal
stream stays bound to the endpoint that was default when the app launched.

Two shapes, depending on whether the old device survives the switch.

- **Old device still present** (speakers → headphones, both connected). The
  stream keeps rendering to the old endpoint. Position advances, the UI is
  correct, and the sound comes out of the wrong device. No error is raised, so
  a stream error callback alone would never see this one.
- **Old device gone** (unplugged, disabled, session moved). cpal raises
  `StreamError::DeviceNotAvailable` into the stream's error callback, which is
  rodio's `default_error_callback` — an `eprintln!`, because the `tracing`
  feature is off. Nothing reaches the app. `rodio::Player`'s position and its
  `sound_count` are both written by the periodic-access closure the mixer pull
  drives, so with the stream dead the position freezes, `Player::empty` stays
  false, and the engine never sees the track end. Playback stalls indefinitely
  with the transport still showing Playing, and the queue does not advance.

  Worse than a stall: `Player::try_seek` blocks on a feedback channel that the
  same dead closure is supposed to answer, and the pending `SeekOrder` holds
  the sender, so it never disconnects either. A scrubber drag against an
  orphaned player hangs the player thread outright.

## Where the fix goes

The engine, over a narrow seam in the sink. `Engine` owns `sink: S`
generically and must keep knowing nothing about devices, but reload-and-seek is
behaviour — which is the engine's job, and the only way it gets deterministic
coverage, since CI has no sound card.

So the trait gains one method, defaulting to a no-op so `FakeSink`, `SilentSink`
and `NullSink` are untouched:

```rust
/// Re-establishes output on the current default device. `Ok(true)` when the
/// output actually changed and the caller must reload.
fn reopen_output(&mut self) -> Result<bool, String> { Ok(false) }
```

`RodioSink` opens a new `MixerDeviceSink`, drops the old `rodio::Player` — it
is bound to the old mixer and the decoder inside it cannot be moved across —
and returns. Nothing else. It never learns what path was loaded.

The engine, on `Ok(true)`: reload the current queue entry, `seek` to the
position it read before the reopen, and restore play or pause. Position
continuity is free: the engine reads `sink.position()` every tick, so a small
backwards jump from an approximate mp3 seek costs nothing but a frame. A reload
that fails means the file went away mid-switch — `Event::Error` and stop, the
same as any other failed load. Nothing here re-announces or re-counts the
track: `started_at`, `announced` and `counted` survive the swap, because it is
the same play.

## How the swap gets triggered

Detection off the player thread, mutation on it. The player thread owns the
sink and is also the thread that has to stay responsive near a track boundary
(`next_tick` tightens to 10ms over the last second), so it must not be the
thread enumerating WASAPI endpoints.

A watcher thread comparing `cpal::default_host().default_output_device()`
against what it saw last poll, roughly once a second, then sending
`Command::OutputChanged` into the player channel. Identity is
`DeviceTrait::id()`, which cpal 0.17 added and which WASAPI implements as
`IMMDevice::GetId()` — stable across reboots and reconnections, and the reason
`name()` is deprecated. The watcher exits when the send fails, which is how it
learns the app is shutting down.

**Transition, not mismatch.** The watcher fires on the default device having
changed since the last poll, never on the default differing from what is open.
`open_default_sink` falls back to any other device when the default will not
open, and `MixerDeviceSink` does not say which device it got, so "what is open"
can legitimately be a non-default endpoint — against which a mismatch test
would fire a reopen, and a decode, every second forever.

That fallback is also why `RodioSink::open` has to acquire the `cpal::Device`
itself rather than call `open_default_sink`: it needs the id, and it needs to
install an error callback. `open_sink_or_fallback` on the chosen device keeps
the config fallback; rodio's wider try-every-other-device fallback is given up,
and no-device still lands on `NullSink` as it does today.

The same command is what the stream error callback sends, once `RodioSink::open`
passes a real `with_error_callback`. That closure runs on a cpal thread and
must not block, so it sets a shared flag and sends — nothing else.

**Coalescing without a clock.** `reopen_output` returns `Ok(false)` when the
default id already matches the one open and no stream error is pending. A
duplicate command then costs one `GetDefaultAudioEndpoint` and no decode, and
a same-device stream failure — which an id comparison alone would wrongly skip
— still forces the reopen, because the flag is set. No debounce timer, and the
engine keeps its one injected clock.

`MixerDeviceSink::drop` `eprintln!`s unless `log_on_drop(false)` is set. Drops
stop being a shutdown-only event here, so set it.

**Considered and rejected for now:** `IMMNotificationClient`, which is the
correct Windows answer — instant, no poll. It needs a COM interface implemented
in this crate, and `windows`'s `#[implement]` expands to `unsafe`, against
`unsafe_code = "forbid"`. Same trade as DPAPI in
[plans/lastfm.md](../../plans/lastfm.md). Revisit if the poll proves too slow.

## Out of scope

Choosing a specific output device in Settings. This issue is only about
following the OS default, which is what the app already claims to do.

## Verification

Against `FakeSink`, deterministically: the position is restored and the paused
state preserved across a reopen, `Ok(false)` changes nothing, a reload that
fails stops with an error, and the scrobble bookkeeping is not reset. Neither
those nor e2e cover the real thing — no test in this repo asserts that sound
came out. Manual, on a machine with two output devices:

- Play a track, switch the default in the Windows sound flyout, and confirm the
  sound moves within about a second, at the same position, with the transport
  unchanged.
- Play a track, unplug or disable the active device, and confirm playback
  continues on the new default rather than freezing.
- Do the second one with no other device present and confirm `player://error`
  reports it.

## Docs

`knowledge/architecture.md` gains the reopen next to "A missing audio device is
not fatal".
