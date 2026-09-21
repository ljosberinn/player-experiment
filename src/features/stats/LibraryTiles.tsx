import { StatTiles } from "../../components/primitives/StatTiles";
import { statsLibraryTotals } from "../../ipc";
import { byteParts, spanParts } from "../../lib/format";
import { useLibraryQuery } from "./useLibraryQuery";
import { usePanelQuery } from "./usePanelQuery";

/**
 * What you own, as six numbers.
 *
 * Cells rather than the row the Listening tab opens with: these six are one
 * kind of answer at one weight, where that tab has four headline counts and
 * three figures that need qualifying. Six in a three-column grid is two rows
 * of the same drawing rather than a row of four with two left over.
 */
export function LibraryTiles() {
  const { query, deps } = useLibraryQuery();
  const { data: totals } = usePanelQuery(() => statsLibraryTotals(query), deps);

  const duration = totals === null ? null : spanParts(totals.durationMs);
  const size = totals === null ? null : byteParts(totals.bytes);

  return (
    <StatTiles
      tiles={[
        { label: "Songs", value: count(totals?.tracks) },
        { label: "Artists", value: count(totals?.artists) },
        { label: "Releases", value: count(totals?.albums) },
        {
          label: "Duration",
          value: duration === null ? "—" : duration[0],
          ...(duration === null ? {} : { unit: duration[1] }),
        },
        {
          label: "Size",
          value: size === null ? "—" : size[0],
          ...(size === null ? {} : { unit: size[1] }),
        },
        {
          label: "Missing",
          value: count(totals?.missing),
          caption: "files that cannot be found",
        },
      ]}
    />
  );
}

function count(value: number | undefined): string {
  return value === undefined ? "—" : value.toLocaleString();
}
