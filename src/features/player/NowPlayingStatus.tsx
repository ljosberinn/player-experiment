import type React from "react";
import { NowPlaying } from "../../components/ui/NowPlaying";
import { useLibraryStore } from "../library/store";
import { usePlayerStore } from "./store";

/**
 * Cover art and track text, subscribed to the player on its own behalf.
 *
 * Reads only which track is playing, so it re-renders once a song rather than
 * on every playhead tick - the tick lives in `PlayerScrubber` next to it. The
 * library summary it used to show when nothing was playing moved to the footer
 * in phase 35, where the design puts it.
 */
export function NowPlayingStatus({
  ref,
}: {
  /**
   * Forwarded to the box itself, which is what the error popover points at.
   * Required rather than optional: the popover has nowhere to anchor without
   * it, and `exactOptionalPropertyTypes` makes an optional one awkward to pass
   * straight through to `NowPlaying`.
   */
  ref: React.Ref<HTMLDivElement>;
}) {
  const track = usePlayerStore((s) => s.track);
  const showTrackGroup = useLibraryStore((s) => s.showTrackGroup);

  return (
    <NowPlaying
      ref={ref}
      track={track}
      onReveal={() => {
        if (track !== null) {
          void showTrackGroup(track);
        }
      }}
    />
  );
}
