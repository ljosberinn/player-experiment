import type { Track } from "../../ipc";
import { fileNameOf } from "../../lib/format";

/** The product name, and the whole title when nothing is playing. */
export const APP_TITLE = "Apex";

/**
 * What the frame, the taskbar and Alt+Tab say the window is.
 *
 * It was the taskbar and Alt+Tab alone until phase 119, when `decorations:
 * false` went and the OS took the frame back - so this line is now also what
 * the app says about itself while it is in front of you, not only while it is
 * behind something else.
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
