import type { ListenQuery } from "../../ipc";
import { useLibraryStore } from "../library/store";
import { listenQuery } from "./filters";
import { useStatsStore } from "./store";

/**
 * The `ListenQuery` every Listening panel counts over, and the deps it
 * refetches on.
 *
 * `useLibraryQuery`'s counterpart, and here for its reason: each panel
 * subscribed to the same two things by hand and called `listenQuery` itself,
 * which is seven copies of the dependency list and seven places for the next
 * one to be forgotten in. The album grouping is what forced the issue -
 * `groupVersion` has to reach all seven, not only the two that draw an album
 * by name.
 *
 * `deps` is what it is because the query is rebuilt each render: a panel
 * passing the query object to `usePanelQuery` would refetch on every render
 * of anything above it.
 */
export function useListenQuery(): { query: ListenQuery; deps: readonly unknown[] } {
  const filters = useStatsStore((s) => s.filters);
  // Not in the query, only in the deps: a correction changes which plays are
  // one album rather than what is being asked for, so there is nothing to
  // send and everything to refetch.
  const groupVersion = useStatsStore((s) => s.groupVersion);
  const path = useLibraryStore((s) => s.statsPath);

  return {
    query: listenQuery(filters, path, new Date()),
    deps: [filters, path, groupVersion],
  };
}
