import { Bar } from "../../../components/charts/Bar";
import type { ListenQuery, TimeBucket, TimeCount, TimeRange } from "../../../ipc";
import { useLibraryStore } from "../../library/store";
import { listenQuery } from "../filters";
import { listenTotalsOnce } from "../listenTotals";
import { BUCKET_TITLES, bucketFor, bucketLabel, fillSeries } from "../series";
import { useStatsStore } from "../store";
import { usePanelQuery } from "../usePanelQuery";
import { StatsPanel } from "./StatsPanel";

export interface SeriesPanelProps {
  readonly title: string;
  /** The aggregate: plays, or artists heard for the first time. */
  readonly aggregate: (query: ListenQuery, bucket: TimeBucket) => Promise<TimeCount[]>;
  /** What one bar counts, for the table and the readout. */
  readonly noun: string;
}

interface Series {
  readonly bucket: TimeBucket;
  readonly counts: readonly TimeCount[];
}

/**
 * A count per stretch of time, across the whole range.
 *
 * One component with a caller per aggregate, the way `HistogramPanel` is: the
 * two series are cut, filled and drawn the same way and differ only in what a
 * bar counts.
 */
export function SeriesPanel({ title, aggregate, noun }: SeriesPanelProps) {
  const filters = useStatsStore((s) => s.filters);
  const path = useLibraryStore((s) => s.statsPath);

  const { data, loading } = usePanelQuery(async (): Promise<Series | null> => {
    const query = listenQuery(filters, path, new Date());
    const span = await spanOf(query);
    if (span === null) {
      return null;
    }
    const bucket = bucketFor(span);
    const counts = await aggregate(query, bucket);
    // An all-zero axis is not a chart of nothing: it says so instead.
    return counts.length === 0 ? null : { bucket, counts: fillSeries(counts, bucket, span) };
  }, [filters, path]);

  const bucket = data?.bucket ?? "month";

  return (
    <StatsPanel title={title}>
      <Bar
        label={`${noun} per ${bucket}`}
        data={(data?.counts ?? []).map((entry) => ({
          label: bucketLabel(entry.start, bucket),
          value: entry.count,
        }))}
        format={(count) => count.toLocaleString()}
        columns={[BUCKET_TITLES[bucket], noun]}
        empty="Nothing in this range."
        loading={loading}
      />
    </StatsPanel>
  );
}

/**
 * The stretch of time the axis covers: the range, or under all time the
 * history's own first and last play.
 *
 * The tiles ask `listen_totals` for the same query, and `listenTotalsOnce`
 * hands this the scan they started rather than a second one.
 */
async function spanOf(query: ListenQuery): Promise<TimeRange | null> {
  if (query.range !== null) {
    return query.range;
  }
  const { firstAt, lastAt } = await listenTotalsOnce(query);
  return firstAt === null || lastAt === null ? null : { from: firstAt, to: lastAt + 1 };
}
