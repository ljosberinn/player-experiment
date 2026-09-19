import { BarList } from "../../../components/charts/BarList";
import { statsHistogram } from "../../../ipc";
import { useLibraryQuery } from "../useLibraryQuery";
import { usePanelQuery } from "../usePanelQuery";
import { StatsPanel } from "./StatsPanel";

/**
 * How many tracks are at each sample rate.
 *
 * **Not a chart.** Five values with names is a ranked list, and `BarList` is
 * already the table a chart would need a toggle to become. `histogram` bins
 * this field at one, so the rows it returns are exactly the rates present.
 *
 * Ordered by count rather than by rate, which is what a list is for: the
 * question is what the library mostly is, not what the ladder looks like.
 */
export function SampleRates() {
  const { query, deps } = useLibraryQuery();
  const { data, loading } = usePanelQuery(() => statsHistogram(query, "sampleRate"), deps);

  const entries = (data ?? [])
    .map((bin) => ({ key: `${(bin.value / 1000).toLocaleString()} kHz`, value: bin.count }))
    .sort((a, b) => b.value - a.value);

  return (
    <StatsPanel title="Sample rates">
      <BarList
        entries={entries}
        format={(count) => count.toLocaleString()}
        empty="Nothing here reports a sample rate."
        loading={loading}
      />
    </StatsPanel>
  );
}
