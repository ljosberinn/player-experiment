# 153 — No player bar until something plays

`.player-bar` renders with nothing loaded. Hide it until a track is loaded;
paused still counts as loaded. Stopping or the queue running out hides it again.

Space and the media keys with nothing loaded keep today's behaviour.

## Verification

- Launch, empty queue: no player bar, content takes the height.
- Play → bar appears; pause → stays; stop / queue ends → gone.
- No layout jump in the song table beyond the bar's height; scroll position kept.
- Screenshots refreshed.
