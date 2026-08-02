import { create } from "zustand";
import {
  allTrackIds,
  countTracks,
  queryTracks,
  type SortDirection,
  type SortField,
  type Track,
  type TrackQuery,
} from "../../ipc";
import {
  evictFarPages,
  missingPages,
  PAGE_SIZE,
  type PageState,
  pageIndexOf,
  pagesForRange,
  rowAt,
} from "./pageCache";
import { applyClick, type ClickModifiers, emptySelection, type Selection } from "./selection";

interface LibraryState {
  /** Total rows matching the current query; drives the scrollbar. */
  total: number;
  pages: PageState;
  inFlight: Set<number>;
  search: string;
  sortBy: SortField;
  direction: SortDirection;
  selection: Selection;
  loading: boolean;
  error: string | null;

  /** Reloads the count and drops cached pages; call after any query change. */
  refresh: () => Promise<void>;
  ensureRange: (startIndex: number, endIndex: number) => Promise<void>;
  rowAt: (rowIndex: number) => Track | null;
  setSearch: (search: string) => Promise<void>;
  toggleSort: (field: SortField) => Promise<void>;
  clickRow: (rowIndex: number, id: number, modifiers: ClickModifiers) => void;
  selectAll: () => Promise<void>;
  clearSelection: () => void;
}

function queryFor(state: Pick<LibraryState, "search" | "sortBy" | "direction">): TrackQuery {
  return {
    search: state.search.trim() === "" ? null : state.search,
    sortBy: state.sortBy,
    direction: state.direction,
    offset: 0,
    limit: PAGE_SIZE,
  };
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  total: 0,
  pages: new Map(),
  inFlight: new Set(),
  search: "",
  sortBy: "artist",
  direction: "asc",
  selection: emptySelection,
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const total = await countTracks(queryFor(get()));
      // Every cached page belongs to the previous query, so none of it can be
      // reused once the query changes.
      set({ total, pages: new Map(), inFlight: new Set(), loading: false });
    } catch (cause) {
      set({ error: String(cause), loading: false });
    }
  },

  ensureRange: async (startIndex, endIndex) => {
    const { pages, inFlight, total } = get();
    if (total === 0) {
      return;
    }
    const visible = pagesForRange(startIndex, Math.min(endIndex, total - 1));
    const wanted = missingPages(visible, pages, inFlight);
    if (wanted.length === 0) {
      return;
    }

    set({ inFlight: new Set([...inFlight, ...wanted]) });

    await Promise.all(
      wanted.map(async (page) => {
        try {
          const rows = await queryTracks({
            ...queryFor(get()),
            offset: page * PAGE_SIZE,
            limit: PAGE_SIZE,
          });
          set((state) => {
            const next = new Map(state.pages);
            next.set(page, rows);
            const stillInFlight = new Set(state.inFlight);
            stillInFlight.delete(page);
            return { pages: evictFarPages(next, visible), inFlight: stillInFlight };
          });
        } catch (cause) {
          set((state) => {
            const stillInFlight = new Set(state.inFlight);
            stillInFlight.delete(page);
            return { error: String(cause), inFlight: stillInFlight };
          });
        }
      }),
    );
  },

  rowAt: (rowIndex) => rowAt(get().pages, rowIndex),

  setSearch: async (search) => {
    set({ search, selection: emptySelection });
    await get().refresh();
  },

  toggleSort: async (field) => {
    const { sortBy, direction } = get();
    set({
      sortBy: field,
      direction: sortBy === field && direction === "asc" ? "desc" : "asc",
    });
    await get().refresh();
  },

  clickRow: (rowIndex, id, modifiers) => {
    set((state) => ({
      selection: applyClick(state.selection, rowIndex, id, modifiers, (from, to) => {
        // Only rows currently cached can contribute ids; a range spanning
        // evicted pages selects what is loaded rather than blocking the click.
        const ids: number[] = [];
        for (let index = from; index <= to; index++) {
          const track = rowAt(state.pages, index);
          if (track) {
            ids.push(track.id);
          }
        }
        return ids;
      }),
    }));
  },

  selectAll: async () => {
    // Ids, not rows: selecting everything must neither depend on what happens
    // to be cached nor be truncated by the backend's page cap.
    try {
      const ids = await allTrackIds(queryFor(get()));
      set({ selection: { ids: new Set(ids), anchorIndex: 0 } });
    } catch (cause) {
      set({ error: String(cause) });
    }
  },

  clearSelection: () => set({ selection: emptySelection }),
}));

export { PAGE_SIZE, pageIndexOf };
