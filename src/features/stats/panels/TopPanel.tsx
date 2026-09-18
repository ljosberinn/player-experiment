import { BarList } from "../../../components/charts/BarList";
import { type ListenDimension, statsTop } from "../../../ipc";
import { useLibraryStore } from "../../library/store";
import { listenQuery } from "../filters";
import { listenTotalsOnce } from "../listenTotals";
import { drill, type StatsCrumb } from "../path";
import { useStatsStore } from "../store";
import { usePanelQuery } from "../usePanelQuery";
import { StatsPanel } from "./StatsPanel";

/** How many rows a top list draws. Ten is what fits without a scrollbar. */
const ROWS = 10;

const TITLES: Record<ListenDimension, string> = {
  artist: "Top artists",
  album: "Top albums",
  track: "Top tracks",
  genre: "Top genres",
};

/**
 * Which drill-down a row opens, where it opens one.
 *
 * A track has no entry because `ListenQuery` has no track field: the three
 * kinds here are exactly the three `StatsCrumb` kinds, and inventing a fourth
 * would be a crumb the query cannot honour.
 */
const DRILLS: Partial<Record<ListenDimension, StatsCrumb["kind"]>> = {
  artist: "artist",
  album: "album",
  genre: "genre",
};

export interface TopPanelProps {
  readonly dimension: ListenDimension;
}

/**
 * The most played artists, albums, tracks or genres, as a bar list.
 *
 * One component for all four: the answer has the same shape each time, and
 * four near-identical panels would be four places to fix a drill-down.
 *
 * Subscribes to the filters and the drill path itself - `App` and
 * `StatisticsView` must not re-render because a range changed.
 */
export function TopPanel({ dimension }: TopPanelProps) {
  const filters = useStatsStore((s) => s.filters);
  const path = useLibraryStore((s) => s.statsPath);
  const showStatsPath = useLibraryStore((s) => s.showStatsPath);

  const query = listenQuery(filters, path, new Date());
  const { data, loading } = usePanelQuery(
    () => statsTop(query, dimension, ROWS),
    [filters, path, dimension],
  );

  // Only for the genre panel, and only because genre is knowable for a matched
  // play alone: reporting the matched subset as the whole is the failure mode
  // the plan names, so the panel says what it covers instead.
  const coverage = usePanelQuery(
    () => (dimension === "genre" ? listenTotalsOnce(query) : Promise.resolve(null)),
    [filters, path, dimension],
  );

  const kind = DRILLS[dimension];

  return (
    <StatsPanel title={TITLES[dimension]}>
      <BarList
        entries={(data ?? []).map((entry) => ({ ...entry, value: entry.plays }))}
        format={(plays) => plays.toLocaleString()}
        empty="Nothing in this range."
        loading={loading}
        {...(kind !== undefined && path !== null
          ? { onSelect: (entry) => void showStatsPath(drill(path, { kind, key: entry.key })) }
          : {})}
        {...(coverage.data !== null && coverage.data.plays > 0
          ? {
              caption: `Genre known for ${Math.round(
                (coverage.data.withGenre / coverage.data.plays) * 100,
              )}% of plays.`,
            }
          : {})}
      />
    </StatsPanel>
  );
}
