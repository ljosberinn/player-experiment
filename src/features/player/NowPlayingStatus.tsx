import { useState } from "react";
import { type Heard, NowPlaying } from "../../components/ui/NowPlaying";
import type { Track } from "../../ipc";
import { useLibraryStore } from "../library/store";
import { lastPlayedWords, showLastPlay } from "../stats/lastPlay";
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

  // The plays as the song loaded, which are the plays before this one. Every
  // pause, seek or volume step re-reads the track, and once this play counts
  // that read says it was last played today.
  const [loaded, setLoaded] = useState(track);
  if (track?.id !== loaded?.id) {
    setLoaded(track);
  }
  const before = loaded?.id === track?.id ? loaded : track;
  const lastPlayedAt = before?.last_played_at ?? null;

  return (
    <NowPlaying
      track={track}
      heard={before === null ? null : heard(before)}
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
      onShowLastPlay={() => {
        if (lastPlayedAt !== null) {
          void showLastPlay(lastPlayedAt);
        }
      }}
    />
  );
}

function heard(track: Track): Heard {
  const at = track.last_played_at;
  return {
    plays: track.play_count,
    last:
      at === null
        ? null
        : {
            words: lastPlayedWords(at, new Date()),
            title: new Date(at * 1000).toLocaleString(undefined, {
              dateStyle: "long",
              timeStyle: "short",
            }),
          },
  };
}
