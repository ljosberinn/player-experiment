import { create } from "zustand";
import {
  clearGenreOverride,
  loadStatsFilters,
  saveStatsFilters,
  setGenreOverride,
  statsPinAlbum,
} from "../../ipc";
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
  /**
   * Bumped whenever the genre tree is corrected.
   *
   * An override changes which tracks every genre-filtered aggregate counts,
   * and no track row moves - so `library://changed` would be a lie, and the
   * panels have nothing else to hear. `useLibraryQuery` lists this among its
   * deps, which is the one place that has to: fifteen panels listing it by
   * hand is where one of them forgets and keeps drawing the tree as it was.
   */
  genreVersion: number;
  /**
   * Bumped whenever an album grouping is corrected.
   *
   * `genreVersion`'s counterpart for the Listening tab, and separate from it
   * for the reason that one is separate from `library://changed`: a pin moves
   * no track row, and the two versions wake different halves of the view.
   * `useListenQuery` lists this among its deps, which is the one place that
   * has to.
   */
  groupVersion: number;
  /** Reads the stored filters. Called when the view mounts, not at startup. */
  load: () => Promise<void>;
  /** Applies a change and stores the whole set behind it. */
  setFilters: (change: Partial<StatsFilters>) => void;
  /**
   * Files `label` under `parent`, or at the top of the tree when null.
   *
   * Rejects rather than reporting: the dialog that calls this has a field to
   * put the message beside, which is closer to what was typed than the status
   * bar is. Both refusals come from `set_override` in Rust.
   */
  setOverride: (label: string, parent: string | null) => Promise<void>;
  /** Drops `label`'s correction, so it resolves the way it did before. */
  clearOverride: (label: string) => Promise<void>;
  /**
   * Records that `spellings` read under `heading`.
   *
   * Rejects rather than reporting, for `setOverride`'s reason: the dialog
   * that calls this has a field to put the message beside. Both refusals come
   * from `pin_album` in Rust.
   */
  pinAlbum: (artist: string, spellings: readonly string[], heading: string) => Promise<void>;
}

export const useStatsStore = create<StatsState>((set, get) => ({
  filters: DEFAULT_FILTERS,
  genreVersion: 0,
  groupVersion: 0,

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

  setOverride: async (label, parent) => {
    // Bumped after the write rather than before it: a refused correction has
    // changed nothing, and refetching every panel over it would redraw the
    // same numbers and hide the fact that nothing happened.
    await setGenreOverride(label, parent);
    set({ genreVersion: get().genreVersion + 1 });
  },

  clearOverride: async (label) => {
    await clearGenreOverride(label);
    set({ genreVersion: get().genreVersion + 1 });
  },

  pinAlbum: async (artist, spellings, heading) => {
    // After the write, for the reason `setOverride` gives: a refused
    // correction has changed nothing.
    await statsPinAlbum(artist, spellings, heading);
    set({ groupVersion: get().groupVersion + 1 });
  },
}));
