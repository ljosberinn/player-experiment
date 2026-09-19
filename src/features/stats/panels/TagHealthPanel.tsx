import { BarList } from "../../../components/charts/BarList";
import { statsTagHealth, type TagHealth } from "../../../ipc";
import { useLibraryQuery } from "../useLibraryQuery";
import { usePanelQuery } from "../usePanelQuery";
import { StatsPanel } from "./StatsPanel";

/** The fields worth counting, in the order a tag editor shows them. */
const FIELDS: ReadonlyArray<readonly [keyof TagHealth, string]> = [
  ["title", "Title"],
  ["artist", "Artist"],
  ["album", "Album"],
  ["albumArtist", "Album artist"],
  ["genre", "Genre"],
  ["year", "Year"],
  ["trackNo", "Track number"],
  ["cover", "Artwork"],
];

/**
 * How many songs are missing each tag.
 *
 * Counts, and no link out to the songs behind them: a library query for
 * "tracks with no genre" does not exist - `TrackQuery` has no empty-field
 * filter - and adding one is a phase rather than a row's `onClick`.
 *
 * Each count carries its share of the library beside it. The bar behind it is
 * `BarList`'s - relative to the worst field - and the two answer different
 * questions: which tag is worst, and whether "worst" means anything.
 */
export function TagHealthPanel() {
  const { query, deps } = useLibraryQuery();
  const { data, loading } = usePanelQuery(() => statsTagHealth(query), deps);

  const tracks = data?.tracks ?? 0;
  const entries =
    data === null
      ? []
      : FIELDS.flatMap(([field, name]) =>
          data[field] === 0 ? [] : [{ key: name, value: data[field] }],
        );

  return (
    <StatsPanel title="Tag health">
      <BarList
        entries={entries}
        format={(missing) =>
          tracks === 0
            ? missing.toLocaleString()
            : `${missing.toLocaleString()} (${Math.round((missing / tracks) * 100)}%)`
        }
        empty="Every song here carries every tag."
        loading={loading}
        caption={tracks === 0 ? undefined : `Missing, out of ${tracks.toLocaleString()} songs.`}
      />
    </StatsPanel>
  );
}
