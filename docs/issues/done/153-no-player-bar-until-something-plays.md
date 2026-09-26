# 153 — No player bar until something plays

`.player-bar` is drawn only while a track is loaded; paused counts, stopped
does not. Stopping or the queue running out hides it again, and the body takes
the height.

Space and the media keys with nothing loaded keep today's behaviour.

## The bar

`PlayerBar` subscribes to `status !== "stopped"` itself, so App gains no
subscription. Keyed on `status`, not `track`: `Engine::stop` keeps the queue
index, so the snapshot still names a track after a stop.

## Errors become a dialog

`ErrorPopover` anchored to `NowPlaying` in the bar, and a failed load ends in a
stop. `ErrorDialog` replaces it: an alert dialog with the message and OK, for
every `report()` caller.

## Tests

- e2e: `transport.test.ts` → `player-bar.test.ts`, after `playback`; it plays a
  row first and takes over the bar's layout and contrast checks from
  `appearance`, plus pause keeps it, stop drops it, Space brings it back.
  `appearance` asserts the body reaches the bottom with no bar; `smoke` asserts
  no bar over an empty library.
- Stories: `UI/ErrorDialog`; `PlayerBar` renders the component.
