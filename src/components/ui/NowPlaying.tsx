import type React from "react";
import type { Track } from "../../ipc";
import { coverUrl } from "../../ipc";

/**
 * Cover art and two lines of text, in the middle of the transport strip.
 *
 * What is left of the old `StatusDisplay` once phase 35 took the scrubber out of
 * it and moved the library summary down to the footer. The box keeps its ref:
 * it is where the app says what is playing, and therefore where a playback error
 * belongs to be pointed at.
 *
 * Present when nothing is playing as well, saying so. The strip is a fixed row
 * and this is the widest thing on it; a box that appeared with the first song
 * would shove the volume and the search field sideways as it arrived.
 */
export function NowPlaying({
  track,
  ref,
}: {
  track: Track | null;
  ref?: React.Ref<HTMLDivElement>;
}) {
  const title = track === null ? "Nothing playing" : (track.title ?? fileName(track.path));
  const subtitle = track === null ? "" : [track.artist, track.album].filter(Boolean).join(" — ");

  return (
    <div className="now-playing" data-testid="now-playing" ref={ref}>
      {track?.cover_hash ? (
        <img className="now-playing-cover" src={coverUrl(track.cover_hash)} alt="" />
      ) : (
        <div className="now-playing-cover now-playing-cover-empty" aria-hidden="true" />
      )}

      <div className="now-playing-text">
        <div className="now-playing-title">{title}</div>
        {/* A non-breaking space rather than nothing: the line holds its height,
            so the title stays put whether or not the song has an artist. */}
        <div className="now-playing-subtitle">{subtitle === "" ? " " : subtitle}</div>
      </div>
    </div>
  );
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
