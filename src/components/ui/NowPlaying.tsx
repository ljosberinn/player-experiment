import type React from "react";
import type { Track } from "../../ipc";
import { coverUrl } from "../../ipc";
import { fileNameOf } from "../../lib/format";

/**
 * Cover art and two lines of text, in the middle of the transport strip.
 *
 * What is left of the old `StatusDisplay` once phase 35 took the scrubber out of
 * it and moved the library summary down to the footer. The box keeps its ref:
 * it is where the app says what is playing, and therefore where a playback error
 * belongs to be pointed at.
 *
 * Present when nothing is playing as well, and hidden rather than absent: the
 * strip is a fixed row and this is the widest thing on it, so a box that
 * appeared with the first song would shove the volume and the search field
 * sideways as it arrived. `visibility` keeps the box and drops the contents.
 */
export function NowPlaying({
  track,
  onReveal,
  ref,
}: {
  track: Track | null;
  /** Double-clicked - "show me where this is", the way a file manager does. */
  onReveal?: () => void;
  ref?: React.Ref<HTMLDivElement>;
}) {
  const title = track === null ? "Nothing playing" : (track.title ?? fileNameOf(track.path));
  const subtitle = track === null ? "" : [track.artist, track.album].filter(Boolean).join(" — ");

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a shortcut to the album, not the route to it - the same view is reachable from the sidebar and from the row menu, and a readout of what is playing is not a control.
    <div
      className="now-playing"
      data-testid="now-playing"
      ref={ref}
      // Inline rather than a class: `visibility: hidden` already takes the box
      // out of the accessibility tree, so this is the whole of the change.
      style={track === null ? { visibility: "hidden" } : undefined}
      onDoubleClick={track === null ? undefined : onReveal}
    >
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
