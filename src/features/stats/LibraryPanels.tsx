import { formatDuration } from "../../lib/format";
import { LibraryTiles } from "./LibraryTiles";
import { GenreDonut } from "./panels/GenreDonut";
import { HistogramPanel } from "./panels/HistogramPanel";
import { ReleaseYears } from "./panels/ReleaseYears";
import { SampleRates } from "./panels/SampleRates";
import { TagHealthPanel } from "./panels/TagHealthPanel";
import { WorstByBitrate } from "./panels/WorstByBitrate";

/**
 * What the Library tab draws: quality, then age, then what is wrong with it.
 *
 * Every panel here is a read over `tracks` through `TrackQuery` and `scope`,
 * so the filter bar's scope selector reaches all of them and none of them
 * knows it exists. Each subscribes for itself through `useLibraryQuery`, so a
 * scope change wakes the panels and not this.
 *
 * The genre donut is the one that drills, and a crumb it pushes narrows every
 * panel above it through the same hook.
 */
export function LibraryPanels() {
  return (
    <>
      <LibraryTiles />
      <HistogramPanel
        title="Bitrates"
        field="bitrate"
        // The bin's own edge, not the range: "128" under a bar that holds 128
        // to 159 reads as the rate people actually name.
        bin={(kbps) => `${kbps}`}
        column="kbps"
        empty="Nothing here reports a bitrate."
      />
      <SampleRates />
      <HistogramPanel
        title="Track lengths"
        field="duration"
        bin={(ms) => formatDuration(ms)}
        column="Length"
        empty="Nothing here has a length."
      />
      <ReleaseYears />
      <GenreDonut />
      <WorstByBitrate />
      <TagHealthPanel />
    </>
  );
}
