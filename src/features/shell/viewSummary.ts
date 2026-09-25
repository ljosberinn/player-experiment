import { formatLibrarySummary } from "../../lib/format";
import type { ViewTab } from "../library/store";

/**
 * What the content pane is showing, drawn at the top of the pane since phase
 * 152: beside a browse view's heading, on a drill-in's breadcrumb row, and as
 * a line of its own over the Songs table, which has no heading to carry it.
 *
 * View-scoped rather than library-wide: inside a playlist, a search or an album
 * it counts what is on screen, because that is the question a line over the
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
  // Statistics counts nothing here that it does not already say in letters
  // twice the size, and the browse arm below would call its groups genres.
  if (tab === "stats") {
    return "";
  }

  // An empty view draws an empty state, which says so in a sentence.
  if (tab === "songs" || drilledIn) {
    return trackCount === 0 ? "" : formatLibrarySummary(trackCount, durationMs, bytes);
  }

  if (groupCount === 0) {
    return "";
  }
  const noun = tab === "albums" ? "release" : tab === "artists" ? "artist" : "genre";
  return `${groupCount.toLocaleString()} ${groupCount === 1 ? noun : `${noun}s`}`;
}
