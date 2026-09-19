import { StatTile } from "../../components/charts/StatTile";
import { statsLibraryTotals } from "../../ipc";
import { formatBytes, formatSpan } from "../../lib/format";
import { useLibraryQuery } from "./useLibraryQuery";
import { usePanelQuery } from "./usePanelQuery";

/** What you own, as six numbers. */
export function LibraryTiles() {
  const { query, deps } = useLibraryQuery();
  const { data: totals } = usePanelQuery(() => statsLibraryTotals(query), deps);

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
