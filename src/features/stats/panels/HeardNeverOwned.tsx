import { BarList } from "../../../components/charts/BarList";
import { statsTop } from "../../../ipc";
import { report } from "../../shell/statusStore";
import { saveCsv, toCsv } from "../csv";
import { useListenQuery } from "../useListenQuery";
import { usePanelQuery } from "../usePanelQuery";
import { StatsPanel } from "./StatsPanel";

/**
 * How many rows the list draws and the export writes.
 *
 * Larger than a top list because this one is read to the end: it is a
 * shopping list, not a ranking, and the tail is the part you have not bought.
 */
const ROWS = 200;

/**
 * Tracks played often and never owned as a file.
 *
 * This is why a play with no matching file is kept at import rather than
 * discarded: the residue is the point, not a leftover. Discarding it would
 * also make the history a function of whichever files happened to be scanned
 * that day.
 */
export function HeardNeverOwned() {
  const { query: scoped, deps } = useListenQuery();

  // `owned: false` overrides whatever the filter bar's Owned select says,
  // because this panel *is* the unowned view. Obeying the select would let it
  // be filtered to owned plays and draw nothing, which reads as "you own
  // everything" rather than as "you asked the wrong question".
  const query = { ...scoped, owned: false };
  const { data, loading } = usePanelQuery(() => statsTop(query, "track", ROWS), deps);

  const entries = data ?? [];

  const exportCsv = () => {
    const csv = toCsv(
      ["Artist", "Title", "Plays"],
      entries.map((entry) => [entry.secondary ?? "", entry.key, String(entry.plays)]),
    );
    // A notice rather than a report on failure would need a line of its own;
    // the save dialog already told the user where it was going, and a write
    // that fails there is an error like any other.
    saveCsv("heard-never-owned.csv", csv).catch(report);
  };

  return (
    <StatsPanel
      title="Heard, never owned"
      action={
        <button
          type="button"
          className="stats-action"
          onClick={exportCsv}
          disabled={entries.length === 0}
        >
          Export…
        </button>
      }
    >
      <BarList
        entries={entries.map((entry) => ({ ...entry, value: entry.plays }))}
        format={(plays) => plays.toLocaleString()}
        empty="Every play in this range matched a file."
        loading={loading}
        caption="Plays with no file behind them, whatever the Owned filter is set to."
      />
    </StatsPanel>
  );
}
