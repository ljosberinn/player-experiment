import type React from "react";
import { StatusDisplay } from "../../components/ui/StatusDisplay";
import { formatLibrarySummary } from "../../lib/format";
import { useLibraryStore } from "../library/store";
import { usePlayerStore } from "./store";

/**
 * The toolbar's status box, subscribed to the playhead on its own behalf.
 *
 * This exists for one reason: `positionMs` changes four times a second for the
 * whole length of every song, and it used to be read at the top of `App`. Every
 * tick therefore re-rendered the entire tree - the song table and its forty
 * virtualized rows included - to move a scrubber a pixel. Reading it here
 * confines the tick to this box.
 *
 * The measurement is in `App.renders.test.tsx`: 960 song-table renders over a
 * four-minute track before, none after.
 */
export function NowPlayingStatus({
  ref,
}: {
  /**
   * Forwarded to the box itself, which is what the error popover points at.
   * Required rather than optional: the popover has nowhere to anchor without
   * it, and `exactOptionalPropertyTypes` makes an optional one awkward to pass
   * straight through to `StatusDisplay`.
   */
  ref: React.Ref<HTMLDivElement>;
}) {
  const track = usePlayerStore((s) => s.track);
  const positionMs = usePlayerStore((s) => s.positionMs);
  const seek = usePlayerStore((s) => s.seek);
  // The library summary is what the box shows when nothing is playing, so it
  // belongs to the same component even though it comes from another store.
  const stats = useLibraryStore((s) => s.stats);

  return (
    <StatusDisplay
      ref={ref}
      track={track}
      positionMs={positionMs}
      summary={formatLibrarySummary(stats.tracks, stats.durationMs)}
      onSeek={(value) => void seek(value)}
    />
  );
}
