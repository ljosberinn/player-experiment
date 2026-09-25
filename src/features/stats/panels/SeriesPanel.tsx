import { Bar } from "../../../components/charts/Bar";
import type { ListenQuery, ListenTotals, TimeBucket, TimeCount, TimeRange } from "../../../ipc";
import { useLibraryStore } from "../../library/store";
import { listenTotalsOnce } from "../listenTotals";
import { drill } from "../path";
import { BUCKET_TITLES, bucketFor, bucketLabel, fillSeries } from "../series";
import { useListenQuery } from "../useListenQuery";
import { usePanelQuery } from "../usePanelQuery";
import { StatsPanel } from "./StatsPanel";

export interface SeriesPanelProps {
  readonly title: string;
  /** The aggregate: plays, or artists heard for the first time. */
  readonly aggregate: (query: ListenQuery, bucket: TimeBucket) => Promise<TimeCount[]>;
  /** What one bar counts, for the table and the readout. */
  readonly noun: string;
  /** The total the bars are a part of, for the coverage caption. */
  readonly whole: "plays" | "artists";
}

interface Series {
  readonly bucket: TimeBucket;
  readonly counts: readonly TimeCount[];
}

interface Answer {
  readonly series: Series | null;
  readonly caption: string | null;
}

const COVERAGE: Record<SeriesPanelProps["whole"], (share: number) => string> = {
  plays: (share) => `Date known for ${share}% of plays.`,
  artists: (share) => `First play dated for ${share}% of artists.`,
};

/**
 * A count per stretch of time, across the whole range.
 *
 * One component with a caller per aggregate, the way `HistogramPanel` is: the
 * two series are cut, filled and drawn the same way and differ only in what a
 * bar counts.
 *
 * A bar drills into its own stretch of time, which the tab then cuts finer:
 * a year into weeks, a month or a week into days. A series of one bar is the
 * span it would drill into, so a day stops there.
 */
export function SeriesPanel({ title, aggregate, noun, whole }: SeriesPanelProps) {
  const path = useLibraryStore((s) => s.statsPath);
  const showStatsPath = useLibraryStore((s) => s.showStatsPath);
  const { query, deps } = useListenQuery();

  const { data, loading } = usePanelQuery(async (): Promise<Answer> => {
    // Asked before the series rather than after it, so that under a range,
    // where the span needs no totals, the two are in flight together.
    const asked = listenTotalsOnce(query);
    const span = query.range ?? historySpan(await asked);
    if (span === null) {
      return { series: null, caption: coverage(await asked, 0, whole) };
    }
    const bucket = bucketFor(span);
    const [totals, counts] = await Promise.all([asked, aggregate(query, bucket)]);
    return {
      // An all-zero axis is not a chart of nothing: it says so instead.
      series: counts.length === 0 ? null : { bucket, counts: fillSeries(counts, bucket, span) },
      caption: coverage(
        totals,
        counts.reduce((sum, entry) => sum + entry.count, 0),
        whole,
      ),
    };
  }, deps);

  const bucket = data?.series?.bucket ?? "month";
  const counts = data?.series?.counts ?? [];

  return (
    <StatsPanel title={title} caption={data?.caption ?? null}>
      <Bar
        label={`${noun} per ${bucket}`}
        data={counts.map((entry) => ({
          label: bucketLabel(entry.start, bucket),
          value: entry.count,
        }))}
        format={(count) => count.toLocaleString()}
        columns={[BUCKET_TITLES[bucket], noun]}
        empty="Nothing in this range."
        loading={loading}
        {...(counts.length > 1 && path !== null
          ? {
              onSelect: (index: number) => {
                const entry = counts[index];
                if (entry !== undefined) {
                  void showStatsPath(
                    drill(path, { kind: "period", key: `${entry.start}/${bucket}` }),
                  );
                }
              },
            }
          : {})}
      />
    </StatsPanel>
  );
}

/**
 * The stretch of time all time covers: the history's own first and last
 * dated play.
 *
 * The tiles ask `listen_totals` for the same query, and `listenTotalsOnce`
 * hands this the scan they started rather than a second one.
 */
function historySpan({ firstAt, lastAt }: ListenTotals): TimeRange | null {
  return firstAt === null || lastAt === null ? null : { from: firstAt, to: lastAt + 1 };
}

/**
 * What share of the whole the bars hold, where some of it has no date.
 *
 * Wherever a play is undated the range reaches back before every dated one,
 * so an artist missing from the new ones was first heard undated, and the
 * bars' sum is the placed share of either total.
 */
function coverage(
  totals: ListenTotals,
  placed: number,
  whole: SeriesPanelProps["whole"],
): string | null {
  const total = totals[whole];
  if (totals.dated === totals.plays || total === 0) {
    return null;
  }
  // Down rather than to nearest: the caption is only here because something
  // is missing, and "100%" would say nothing is.
  return COVERAGE[whole](Math.floor((placed / total) * 100));
}
