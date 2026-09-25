import type React from "react";
import type { Track } from "../../ipc";
import { coverUrl } from "../../ipc";
import { fileNameOf } from "../../lib/format";

/**
 * Cover art, the title and the artist, at the left of the player bar.
 *
 * What is left of the old `StatusDisplay` once phase 35 took the scrubber out of
 * it and moved the library summary down to the footer. The box keeps its ref:
 * it is where the app says what is playing, and therefore where a playback error
 * belongs to be pointed at.
 *
 * Present when nothing is playing as well, and hidden rather than absent, so
 * the bar looks the same shape before and after the first song. `visibility`
 * keeps the box and drops the contents.
 */
export function NowPlaying({
  track,
  onReveal,
  onShowArtist,
  ref,
}: {
  track: Track | null;
  /** The cover or the title clicked: "show me where this is". */
  onReveal?: () => void;
  /** The artist clicked. */
  onShowArtist?: () => void;
  ref?: React.Ref<HTMLDivElement>;
}) {
  const title = track === null ? "Nothing playing" : (track.title ?? fileNameOf(track.path));
  const artist = track?.artist ?? null;

  return (
    <div
      className="now-playing"
      data-testid="now-playing"
      ref={ref}
      // Inline rather than a class: `visibility: hidden` already takes the box
      // out of the accessibility tree, so this is the whole of the change.
      style={track === null ? { visibility: "hidden" } : undefined}
    >
      {/* Out of the tab order and the accessibility tree: the title beside it
          is the same control, and one stop is enough. */}
      <button
        type="button"
        className="now-playing-cover-button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={track === null ? undefined : onReveal}
      >
        {track?.cover_hash ? (
          <img className="now-playing-cover" src={coverUrl(track.cover_hash)} alt="" />
        ) : (
          <div className="now-playing-cover now-playing-cover-empty" />
        )}
      </button>

      <div className="now-playing-text">
        <button
          type="button"
          className="now-playing-title"
          onClick={track === null ? undefined : onReveal}
        >
          {title}
        </button>
        {artist === null ? (
          // A non-breaking space rather than nothing: the line holds its
          // height, so the title stays put whether or not the song has an
          // artist.
          <div className="now-playing-subtitle">{" "}</div>
        ) : (
          <button
            type="button"
            className="now-playing-subtitle"
            onClick={track === null ? undefined : onShowArtist}
          >
            {artist}
          </button>
        )}
      </div>
    </div>
  );
}
