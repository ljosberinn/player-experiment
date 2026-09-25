import { StatRow } from "../../components/primitives/StatRow";
import { StatTiles } from "../../components/primitives/StatTiles";
import { spanParts } from "../../lib/format";
import { activeFilters } from "./filters";
import { listenTotalsOnce } from "./listenTotals";
import { useStatsStore } from "./store";
import { useListenQuery } from "./useListenQuery";
import { usePanelQuery } from "./usePanelQuery";

/**
 * What you have heard, as seven numbers in the two forms section 4a draws.
 *
 * The split is the sheet's own: the four bare counts sit on the rule, and the
 * three that need a line of prose under them take the cells. It draws this
 * tab by name, down to "plays matched to a file".
 *
 * Subscribes to the filters and the drill path itself - `App` and
 * `StatisticsView` must not re-render because a range changed.
 */
export function ListeningTiles() {
  const filters = useStatsStore((s) => s.filters);
  const { query, deps } = useListenQuery();
  const { data: totals } = usePanelQuery(() => listenTotalsOnce(query), deps);

  if (totals !== null && totals.plays === 0) {
    return (
      <p className="empty-state">
        {/* The same answer the token line gives, so an empty state blaming the
            range cannot appear under a line saying nothing is filtered. No
            playlists: a scope token is the Library tab's. */}
        {activeFilters(filters, "listening", []).length === 0
          ? "Nothing has been played yet. Import your last.fm history in Settings ▸ Online."
          : "No plays in this range."}
      </p>
    );
  }

  const spent = totals === null ? null : spanParts(totals.durationMs);

  return (
    <div className="stat-summary">
      <StatRow
        figures={[
          { label: "Plays", value: count(totals?.plays) },
          { label: "Artists", value: count(totals?.artists) },
          { label: "Albums", value: count(totals?.albums) },
          { label: "Tracks", value: count(totals?.tracks) },
        ]}
      />
      <StatTiles
        tiles={[
          {
            label: "Listening days",
            value: count(totals?.days),
            ...(totals !== null && totals.firstAt !== null
              ? { caption: `since ${localDate(totals.firstAt)}` }
              : {}),
          },
          {
            label: "Time spent",
            value: spent === null ? "—" : spent[0],
            ...(spent === null ? {} : { unit: spent[1] }),
            // Said rather than implied: an imported scrobble carries no
            // duration, so this is a sum over the plays that have one.
            ...(totals !== null && totals.timed < totals.plays
              ? { caption: `${share(totals.timed, totals.plays)}% of plays timed` }
              : {}),
          },
          {
            label: "Owned",
            value: totals === null ? "—" : share(totals.owned, totals.plays),
            ...(totals === null ? {} : { unit: "%" }),
            caption: "plays matched to a file",
          },
        ]}
      />
    </div>
  );
}

/** An em dash until the first answer lands, rather than a zero that is a lie. */
function count(value: number | undefined): string {
  return value === undefined ? "—" : value.toLocaleString();
}

/** The share as a bare number: the per-cent sign is a unit on the figure and
 * a written character in the prose, so it is not part of this. */
function share(part: number, whole: number): string {
  return whole === 0 ? "0" : `${Math.round((part / whole) * 100)}`;
}

function localDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString();
}
