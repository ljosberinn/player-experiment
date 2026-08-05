import { Scrubber } from "../../components/ui/Scrubber";
import { usePlayerStore } from "./store";

/**
 * The playhead, subscribed to the position on its own behalf.
 *
 * This exists for one reason: `positionMs` changes four times a second for the
 * whole length of every song, and it used to be read at the top of `App`. Every
 * tick therefore re-rendered the entire tree - the song table and its forty
 * virtualized rows included - to move the playhead a pixel. Reading it here
 * confines the tick to this control.
 *
 * The measurement is in `App.renders.test.tsx`: 960 song-table renders over a
 * four-minute track before, none after.
 */
export function PlayerScrubber() {
  const track = usePlayerStore((s) => s.track);
  const positionMs = usePlayerStore((s) => s.positionMs);
  const seek = usePlayerStore((s) => s.seek);

  return (
    <Scrubber
      positionMs={positionMs}
      durationMs={track?.duration_ms ?? 0}
      onSeek={(value) => void seek(value)}
    />
  );
}
