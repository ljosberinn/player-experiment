import { NowPlayingStatus } from "./NowPlayingStatus";
import { PlayerLove } from "./PlayerLove";
import { PlayerRepeat } from "./PlayerRepeat";
import { PlayerScrubber } from "./PlayerScrubber";
import { PlayerTransport } from "./PlayerTransport";
import { PlayerVolume } from "./PlayerVolume";
import { usePlayerStore } from "./store";

/**
 * The band along the bottom of the window, present only while a track is
 * loaded - paused counts, stopped does not.
 *
 * Keyed on `status` rather than `track`: the engine keeps its queue index
 * through a stop so Play can resume from it, which leaves a track in every
 * snapshot after the first song.
 *
 * Laid out like Spotify's: what is playing, the controls over the playhead,
 * the volume. Each part subscribes to its own store values, because they
 * change on schedules of their own - the playhead four times a second, the
 * volume rail at the pointer's sampling rate, the loved set.
 */
export function PlayerBar() {
  const loaded = usePlayerStore((s) => s.status !== "stopped");

  if (!loaded) {
    return null;
  }

  return (
    <div className="player-bar">
      <div className="player-bar-left">
        <NowPlayingStatus />
        <PlayerLove />
      </div>
      <div className="player-bar-centre">
        <div className="player-controls">
          {/* Repeat's width, so Play sits over the middle of the rail. */}
          <span className="player-controls-slot" aria-hidden="true" />
          <PlayerTransport />
          <PlayerRepeat />
        </div>
        <PlayerScrubber />
      </div>
      <div className="player-bar-right">
        <PlayerVolume />
      </div>
    </div>
  );
}
