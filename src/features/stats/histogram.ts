import type { HistogramBin, HistogramField } from "../../ipc";

/**
 * The bin widths `db::stats::histogram` bins each field at.
 *
 * Restated here because the aggregate returns only the bins that have
 * something in them, and a chart cannot space its bands without knowing the
 * step between them. Change one, change both.
 */
export const BIN_WIDTH: Record<HistogramField, number> = {
  bitrate: 32,
  sampleRate: 1,
  year: 1,
  duration: 60_000,
};

/**
 * Above this many bands, the gaps are not filled.
 *
 * A single track tagged year 0 would otherwise turn a release-year chart into
 * two thousand empty bars around two real ones. The unfilled series is wrong
 * about the spacing and readable; the filled one is right about it and blank.
 */
const MAX_BANDS = 400;

/**
 * `bins` with the empty ones between them put back, `step` apart.
 *
 * The aggregate is a `GROUP BY`, so a year nothing was released in is not a
 * row. Drawn as it arrives, 1994 would sit against 2011 as its neighbour and
 * the chart would say the collection is evenly spread across its whole span.
 */
export function fillBins(bins: readonly HistogramBin[], step: number): HistogramBin[] {
  const first = bins[0];
  const last = bins[bins.length - 1];
  if (first === undefined || last === undefined || step <= 0) {
    return [...bins];
  }

  const bands = Math.floor((last.value - first.value) / step) + 1;
  if (bands > MAX_BANDS) {
    return [...bins];
  }

  const counts = new Map(bins.map((bin) => [bin.value, bin.count]));
  return Array.from({ length: bands }, (_, band) => {
    const value = first.value + band * step;
    return { value, count: counts.get(value) ?? 0 };
  });
}

/** Year bins summed ten at a time, which is the same query read coarser. */
export function toDecades(bins: readonly HistogramBin[]): HistogramBin[] {
  const decades = new Map<number, number>();
  for (const bin of bins) {
    const decade = Math.floor(bin.value / 10) * 10;
    decades.set(decade, (decades.get(decade) ?? 0) + bin.count);
  }
  return Array.from(decades, ([value, count]) => ({ value, count })).sort(
    (a, b) => a.value - b.value,
  );
}
