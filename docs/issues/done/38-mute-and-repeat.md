# 38 — Mute, and repeat-one

Merged in #61.

**Mute.** The speaker left of the volume slider is a button; unmuting restores the
level it was at, not a default. Both the muted flag and the remembered level
persist in `settings`. **Muted is a distinct state from volume 0** — dragging to
zero and pressing mute are different intentions, and unmuting has to tell them
apart.

Moving the rail lifts a mute, which the plan did not say either way: a fill that
follows the pointer over a player that stays silent is a control that appears
broken. The button is the only way back into the muted state.

**Repeat one.** One toggle: off, or this song forever. No repeat-all, no shuffle —
none has ever existed here and none is coming. It sits beside the volume rather
than inside the transport pill, which the design draws as three buttons: repeat is
a setting about what happens next, not a thing to press now.

- **Repeat is not persisted**, unlike mute and volume beside it. An app that came
  back from a restart still looping one song would be a surprise: repeat is done to
  the song playing now, not to the player. It survives a webview reload, because it
  lives in the engine.
- The engine change is in end-of-track handling: with repeat on, `ended` seeks to
  zero and plays again instead of advancing the queue.
- **Each loop counts as a play** — `play_count` and `last_played_at` update exactly
  as a fresh start would, which is what will make it scrobble correctly. A song on
  repeat for an hour has been played, and recording it once would make Most Played
  wrong in the case that matters most.
