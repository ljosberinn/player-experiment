import { useEffect, useState } from "react";
import { StatTile } from "../../components/charts/StatTile";
import { type ListenTotals, statsListenTotals } from "../../ipc";
import { formatSpan } from "../../lib/format";
import { useLibraryStore } from "../library/store";
import { report } from "../shell/statusStore";
import { listenQuery } from "./filters";
import { useStatsStore } from "./store";

/**
 * What you have heard, as six numbers.
 *
 * Subscribes to the filters and the drill path itself - `App` and
 * `StatisticsView` must not re-render because a range changed.
 */
export function ListeningTiles() {
  const filters = useStatsStore((s) => s.filters);
  const path = useLibraryStore((s) => s.statsPath);
  const [totals, setTotals] = useState<ListenTotals | null>(null);

  useEffect(() => {
    let cancelled = false;
    statsListenTotals(listenQuery(filters, path, new Date()))
      .then((loaded) => {
        if (!cancelled) {
          setTotals(loaded);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          report(cause);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filters, path]);

  if (totals !== null && totals.plays === 0) {
    return (
      <p className="empty-state">
        {filters.range === "all" && filters.owned === null && filters.loved === null
          ? "Nothing has been played yet. Import your last.fm history from Settings ▸ last.fm to bring in what came before."
          : "No plays in this range."}
      </p>
    );
  }

  return (
    <div className="stat-tiles">
      <StatTile label="Plays" value={count(totals?.plays)} />
      <StatTile label="Artists" value={count(totals?.artists)} />
      <StatTile label="Albums" value={count(totals?.albums)} />
      <StatTile label="Tracks" value={count(totals?.tracks)} />
      <StatTile
        label="Listening days"
        value={count(totals?.days)}
        {...(totals !== null && totals.firstAt !== null
          ? { secondary: `since ${localDate(totals.firstAt)}` }
          : {})}
      />
      <StatTile
        label="Time spent"
        value={totals === null ? "—" : formatSpan(totals.durationMs)}
        // Said rather than implied: an imported scrobble carries no duration,
        // so this is a sum over the plays that have one.
        {...(totals !== null && totals.timed < totals.plays
          ? { secondary: `${share(totals.timed, totals.plays)} of plays timed` }
          : {})}
      />
      <StatTile
        label="Owned"
        value={totals === null ? "—" : share(totals.owned, totals.plays)}
        secondary="plays matched to a file"
      />
    </div>
  );
}

/** An em dash until the first answer lands, rather than a zero that is a lie. */
function count(value: number | undefined): string {
  return value === undefined ? "—" : value.toLocaleString();
}

function share(part: number, whole: number): string {
  return whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;
}

function localDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString();
}
