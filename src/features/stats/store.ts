import { create } from "zustand";
import { loadStatsFilters, saveStatsFilters } from "../../ipc";
import { DEFAULT_FILTERS, parseFilters, type StatsFilters, serializeFilters } from "./filters";

/**
 * How the Statistics view is filtered, and nothing about where it is pointed.
 *
 * Its own store because a range change must wake the panels and nothing else:
 * in the library store it would re-render every library subscriber, which is
 * the rule `CLAUDE.md` states for `App.tsx` and the lesson `positionMs` and
 * `selection` already paid for. The drill path is deliberately elsewhere - it
 * is navigation, it travels in a `HistoryEntry`, and a copy of it here would
 * drift from the one the history walks.
 */
interface StatsState {
  filters: StatsFilters;
  /** Reads the stored filters. Called when the view mounts, not at startup. */
  load: () => Promise<void>;
  /** Applies a change and stores the whole set behind it. */
  setFilters: (change: Partial<StatsFilters>) => void;
}

export const useStatsStore = create<StatsState>((set, get) => ({
  filters: DEFAULT_FILTERS,

  load: async () => {
    try {
      set({ filters: parseFilters(await loadStatsFilters()) });
    } catch {
      // The defaults are a working filter bar; a preference that will not read
      // is not worth an error over the view it belongs to.
    }
  },

  setFilters: (change) => {
    const filters = { ...get().filters, ...change };
    // Applied locally first, so a select answers the click rather than the
    // round trip. Nothing to reconcile if the write fails: the filters are
    // whatever was last asked for, and the next change tries again.
    set({ filters });
    void saveStatsFilters(serializeFilters(filters)).catch(() => {});
  },
}));
