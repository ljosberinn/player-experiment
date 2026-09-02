import { formatLibrarySummary } from "../../lib/format";
import type { ViewTab } from "../library/store";

/**
 * The line in the middle of the footer: what the content pane is showing.
 *
 * The Songs view lost its heading in phase 35 - a table of 150k rows cannot
 * afford to spend a third of the fold on the word "Songs" - and this is where
 * what that heading carried went. The design puts it in a 27px strip along the
 * bottom, centred, which is where the status bar built in phase 9 already was.
 *
 * View-scoped rather than library-wide: inside a playlist, a search or an album
 * it counts what is on screen, because that is the question a line under the
 * table answers. `stats` already comes back scoped to the current query, so
 * only the browse views need anything said about them here.
 */
export function viewSummary({
  tab,
  drilledIn,
  groupCount,
  trackCount,
  durationMs,
  bytes,
}: {
  tab: ViewTab;
  /** True inside one album, artist or genre - the content is songs again. */
  drilledIn: boolean;
  /** How many albums, artists or genres the open browse view lists. */
  groupCount: number;
  trackCount: number;
  durationMs: number;
  bytes: number;
}): string {
  if (tab === "songs" || drilledIn) {
    return formatLibrarySummary(trackCount, durationMs, bytes);
  }

  const noun = tab === "albums" ? "release" : tab === "artists" ? "artist" : "genre";
  if (groupCount === 0) {
    return `No ${noun}s`;
  }
  return `${groupCount.toLocaleString()} ${groupCount === 1 ? noun : `${noun}s`}`;
}
