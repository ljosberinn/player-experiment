import { useState } from "react";
import { Bar } from "../../../components/charts/Bar";
import { statsHistogram } from "../../../ipc";
import { fillBins, toDecades } from "../histogram";
import { useLibraryQuery } from "../useLibraryQuery";
import { usePanelQuery } from "../usePanelQuery";
import { StatsPanel } from "./StatsPanel";

/**
 * When the music was released, by year or by decade.
 *
 * **One query, read at two resolutions.** A decade is ten year bins summed,
 * so a second panel beside this one would be a second full scan of `tracks`
 * to draw an arithmetic transform of the first one's answer.
 *
 * Years first, because it is the finer reading and the coarser one is a click
 * away; a library spanning sixty years is sixty bands, which fits.
 */
export function ReleaseYears() {
  const [byDecade, setByDecade] = useState(false);
  const { query, deps } = useLibraryQuery();
  const { data, loading } = usePanelQuery(() => statsHistogram(query, "year"), deps);

  const years = data ?? [];
  const bins = byDecade ? toDecades(years) : fillBins(years, 1);

  return (
    <StatsPanel
      title="Release years"
      action={
        <button
          type="button"
          className="stats-action"
          aria-pressed={byDecade}
          onClick={() => setByDecade((decades) => !decades)}
        >
          {byDecade ? "By year" : "By decade"}
        </button>
      }
    >
      <Bar
        label={byDecade ? "Songs per decade" : "Songs per release year"}
        data={bins.map((bin) => ({
          label: byDecade ? `${bin.value}s` : `${bin.value}`,
          value: bin.count,
        }))}
        format={(count) => count.toLocaleString()}
        columns={[byDecade ? "Decade" : "Year", "Songs"]}
        empty="Nothing here carries a release year."
        loading={loading}
      />
    </StatsPanel>
  );
}
