import { NowPlaying } from "../../components/ui/NowPlaying";
import { useLibraryStore } from "../library/store";
import { usePlayerStore } from "./store";

/**
 * Cover art and track text, subscribed to the player on its own behalf.
 *
 * Reads only which track is playing, so it re-renders once a song rather than
 * on every playhead tick - the tick lives in `PlayerScrubber`. The library
 * summary it used to show when nothing was playing moved to the footer in
 * phase 35, where the design puts it.
 */
export function NowPlayingStatus() {
  const track = usePlayerStore((s) => s.track);
  const showTrackGroup = useLibraryStore((s) => s.showTrackGroup);
  const showTrackArtist = useLibraryStore((s) => s.showTrackArtist);

  return (
    <NowPlaying
      track={track}
      onReveal={() => {
        if (track !== null) {
          void showTrackGroup(track);
        }
      }}
      onShowArtist={() => {
        if (track !== null) {
          void showTrackArtist(track);
        }
      }}
    />
  );
}
