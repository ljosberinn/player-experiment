# 176 — The player bar hides after five idle minutes

Paused for 5 minutes, the player bar hides as it does when the queue runs out
([153](153-no-player-bar-until-something-plays.md)). A status change or a seek
while paused restarts the clock and brings the bar back. A launch that restores
a paused song ([154](154-resume-the-last-song.md)) counts as paused from the
start.

Hiding only; the engine is not stopped. A stop deletes the resume point, so the
song would not come back at the next launch.

`useIdleHidden` subscribes to the store in an effect rather than selecting
`status`, so `PlayerBar` re-renders only when the bar hides or returns; App
gains nothing.

## Tests

- Unit, fake timers: hidden at 5 min paused, not a millisecond before; restored
  paused counts; never while playing; a resume, a pause and a paused seek each
  restart the clock; a seek or a play after hiding shows the bar again.
