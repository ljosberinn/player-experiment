import { useEffect, useState } from "react";
import { StatTile } from "../../components/charts/StatTile";
import { type LibraryTotals, statsLibraryTotals } from "../../ipc";
import { formatBytes, formatSpan } from "../../lib/format";
import { useLibraryStore } from "../library/store";
import { report } from "../shell/statusStore";
import { libraryQuery } from "./filters";
import { useStatsStore } from "./store";

/**
 * What you own, as six numbers.
 *
 * The three view fields are subscribed one at a time rather than as a query
 * object: `queryFor` builds a fresh object per call, which as a selector would
 * be a new value on every store write.
 */
export function LibraryTiles() {
  const filters = useStatsStore((s) => s.filters);
  const search = useLibraryStore((s) => s.search);
  const playlistId = useLibraryStore((s) => s.playlistId);
  const browse = useLibraryStore((s) => s.browse);
  const [totals, setTotals] = useState<LibraryTotals | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = libraryQuery(filters, {
      search: search.trim() === "" ? null : search,
      playlistId,
      browse,
    });
    statsLibraryTotals(query)
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
  }, [filters, search, playlistId, browse]);

  return (
    <div className="stat-tiles">
      <StatTile label="Songs" value={count(totals?.tracks)} />
      <StatTile label="Artists" value={count(totals?.artists)} />
      <StatTile label="Releases" value={count(totals?.albums)} />
      <StatTile label="Duration" value={totals === null ? "—" : formatSpan(totals.durationMs)} />
      <StatTile label="Size" value={totals === null ? "—" : formatBytes(totals.bytes)} />
      <StatTile
        label="Missing"
        value={count(totals?.missing)}
        secondary="files that cannot be found"
      />
    </div>
  );
}

function count(value: number | undefined): string {
  return value === undefined ? "—" : value.toLocaleString();
}
