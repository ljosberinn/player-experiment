import type { Track } from "../../ipc";

/**
 * What the first column of a row has to say, if anything.
 *
 * Nearly always `null`: a library where every file is present and one track is
 * playing has exactly one non-empty cell in it.
 */
export type RowStatus = "playing" | "missing" | null;

/**
 * Narrow and fixed. Wide enough for a glyph at any zoom from phase 21, and
 * deliberately not resizable - there is nothing in it to reveal.
 */
export const STATUS_COLUMN_WIDTH = 26;

/**
 * `playing` rather than the id to compare against: a row is told whether it is
 * the one playing, so that the playing track changing does not look like a
 * changed prop to every other row in the window.
 */
export function rowStatus(track: Track, playing: boolean): RowStatus {
  // Playing wins over missing, and the order matters for one real case: a
  // track marked by a failed load whose file has since come back is playing
  // now, and the mark is stale until the next scan clears it. What the row is
  // doing beats what a scan last thought.
  if (playing) {
    return "playing";
  }
  return track.missing_since === null ? null : "missing";
}
