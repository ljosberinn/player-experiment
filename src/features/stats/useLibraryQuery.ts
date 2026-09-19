import type { TrackQuery } from "../../ipc";
import { useLibraryStore } from "../library/store";
import { libraryQuery } from "./filters";
import { useStatsStore } from "./store";

/**
 * The `TrackQuery` every Library panel counts over, and the deps it refetches
 * on.
 *
 * Each panel would otherwise subscribe to the same four things by hand and
 * call `libraryQuery` itself; six copies of that is where one of them forgets
 * `search` and quietly reports the whole library under a scope that said
 * otherwise.
 *
 * The three view fields are subscribed one at a time rather than as an object:
 * `libraryQuery` builds a fresh object per call, which as a selector would be
 * a new value on every store write.
 *
 * The drill path is subscribed here too, which is what makes a genre crumb
 * narrow the whole tab rather than only the donut it was clicked in - the same
 * thing `listenQuery` does for the Listening tab, in the one place that builds
 * the query instead of in each panel.
 *
 * `deps` is what it is because the query itself is rebuilt each render. A
 * panel passing the query object to `usePanelQuery` would refetch on every
 * render of anything above it.
 */
export function useLibraryQuery(): { query: TrackQuery; deps: readonly unknown[] } {
  const filters = useStatsStore((s) => s.filters);
  // Not in the query, only in the deps: an override changes what a genre
  // *means* rather than what is being asked for, so there is nothing to send
  // and everything to refetch.
  const genreVersion = useStatsStore((s) => s.genreVersion);
  const search = useLibraryStore((s) => s.search);
  const playlistId = useLibraryStore((s) => s.playlistId);
  const browse = useLibraryStore((s) => s.browse);
  const path = useLibraryStore((s) => s.statsPath);

  const query = libraryQuery(
    filters,
    {
      search: search.trim() === "" ? null : search,
      playlistId,
      browse,
    },
    path,
  );

  return { query, deps: [filters, search, playlistId, browse, path, genreVersion] };
}
