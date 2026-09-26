import type { Track } from "../../ipc";
import { fileNameOf } from "../../lib/format";

/** The product name, and the whole title when nothing is playing. */
export const APP_TITLE = "Apex";

/**
 * What the taskbar and Alt+Tab say the window is.
 *
 * With `decorations: false` the title is invisible inside the app, so this is
 * the only place it shows - and the only place the app can say what it is
 * playing while it is behind something else.
 *
 * The product name comes first because that is what the window is filed under:
 * a taskbar button is narrow, and a title starting with the song is a button
 * whose visible half changes every three minutes.
 */
export function windowTitle(track: Track | null): string {
  if (track === null) {
    return APP_TITLE;
  }
  const parts = [APP_TITLE, track.title ?? fileNameOf(track.path)];
  // The artist is dropped rather than shown as a gap: an em dash with nothing
  // after it reads as a title that failed to load.
  if (track.artist !== null && track.artist.trim() !== "") {
    parts.push(track.artist);
  }
  return parts.join(" — ");
}
