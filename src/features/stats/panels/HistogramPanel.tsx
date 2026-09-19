import { Bar } from "../../../components/charts/Bar";
import { type HistogramField, statsHistogram } from "../../../ipc";
import { BIN_WIDTH, fillBins } from "../histogram";
import { useLibraryQuery } from "../useLibraryQuery";
import { usePanelQuery } from "../usePanelQuery";
import { StatsPanel } from "./StatsPanel";

export interface HistogramPanelProps {
  readonly title: string;
  readonly field: HistogramField;
  /** What the bin starting at `value` is called on the axis. */
  readonly bin: (value: number) => string;
  /** What the bin column is called in the table reading. */
  readonly column: string;
  readonly empty: string;
}

/**
 * One field of `tracks` as a distribution.
 *
 * One component with a caller per field, the way `TopPanel` is: the bins
 * differ and the question does not. What a caller supplies is the wording,
 * because "192 kbps" and "4 min" are the same number to everything else here.
 */
export function HistogramPanel({ title, field, bin, column, empty }: HistogramPanelProps) {
  const { query, deps } = useLibraryQuery();
  const { data, loading } = usePanelQuery(() => statsHistogram(query, field), [...deps, field]);

  const bins = fillBins(data ?? [], BIN_WIDTH[field]);

  return (
    <StatsPanel title={title}>
      <Bar
        label={title}
        data={bins.map((entry) => ({ label: bin(entry.value), value: entry.count }))}
        format={(count) => count.toLocaleString()}
        columns={[column, "Songs"]}
        empty={empty}
        loading={loading}
      />
    </StatsPanel>
  );
}
