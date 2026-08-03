import { create } from "zustand";
import {
  allTrackIds,
  type BrowseFilter,
  type BrowseGroup,
  type BrowseKind,
  browseGroups,
  type LibraryStats,
  libraryStats,
  queryTracks,
  type SortDirection,
  type SortField,
  type Track,
  type TrackQuery,
} from "../../ipc";
import { debounce } from "../../lib/debounce";
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

/**
 * How long typing has to pause before the search actually runs.
 *
 * Long enough that a normal typing rhythm produces one query instead of one
 * per keystroke; short enough not to feel laggy. The input itself never waits.
 */
export const SEARCH_DEBOUNCE_MS = 200;

/**
 * Which of the four views is open.
 *
 * Songs is the table; the other three are [`BrowseKind`], so the tab id is the
 * grouping rather than something that has to be mapped onto one.
 */
export type ViewTab = "songs" | BrowseKind;

interface LibraryState {
  /** Total rows matching the current query; drives the scrollbar. */
  total: number;
  /**
   * Totals for the current view, for the footer.
   *
   * Fetched with the count rather than beside it: the two always change
   * together, and `total` is just `stats.tracks` under another name kept for
   * the table, which asks for it on every render.
   */
  stats: LibraryStats;
  pages: PageState;
  inFlight: Set<number>;
  /** What is in the search box right now; updates on every keystroke. */
  searchInput: string;
  /** What the current query is filtered by; trails the input by the debounce. */
  search: string;
  /** The playlist being shown, or null for the whole library. */
  playlistId: number | null;
  /** Which tab is open. Songs is the table; the rest are browse views. */
  tab: ViewTab;
  /**
   * The group that has been drilled into, or null while browsing the list.
   *
   * Also what decides which of the two the content area shows: a browse tab
   * with a filter set is the songs table, scoped.
   */
  browse: BrowseFilter | null;
  /** The albums, artists or genres of the open browse tab. */
  groups: BrowseGroup[];
  groupsLoading: boolean;
  sortBy: SortField;
  direction: SortDirection;
  /**
   * The column sort to return to when the search box is cleared.
   *
   * Searching switches the view to relevance ranking, which would otherwise
   * discard whatever ordering the user had chosen before they started typing.
   */
  sortBeforeSearch: { sortBy: SortField; direction: SortDirection } | null;
  selection: Selection;
  loading: boolean;
  error: string | null;
  /**
   * Identifies the query currently in flight.
   *
   * Every response checks it before writing: a page or a count belonging to a
   * query the user has already moved on from has to be dropped, not rendered.
   * Without this, a slow first search overwrites the results of a later one.
   */
  queryToken: number;

  /** Reloads the count and drops cached pages; call after any query change. */
  refresh: () => Promise<void>;
  /** Reloads the open tab's groups under `refresh`'s token. Internal. */
  loadGroups: (token: number) => Promise<void>;
  /** Switches the view to a playlist, or back to the whole library. */
  showPlaylist: (playlistId: number | null) => Promise<void>;
  /** Opens one of the four tabs, dropping any drill-in the last one had. */
  showTab: (tab: ViewTab) => Promise<void>;
  /** Drills into one album, artist or genre from the open browse tab. */
  openGroup: (group: BrowseGroup) => Promise<void>;
  /** Returns from a drill-in to the group list. */
  closeGroup: () => Promise<void>;
  ensureRange: (startIndex: number, endIndex: number) => Promise<void>;
  rowAt: (rowIndex: number) => Track | null;
  /** Types into the search box; the query itself is debounced. */
  setSearch: (search: string) => void;
  /** Runs the pending search now, for Enter. */
  commitSearch: () => Promise<void>;
  clearSearch: () => Promise<void>;
  toggleSort: (field: SortField) => Promise<void>;
  clickRow: (rowIndex: number, id: number, modifiers: ClickModifiers) => void;
  selectAll: () => Promise<void>;
  clearSelection: () => void;
  /** Every id matching the current query, in view order - the play queue. */
  queueIds: () => Promise<number[]>;
}

function queryFor(
  state: Pick<LibraryState, "search" | "playlistId" | "browse" | "sortBy" | "direction">,
): TrackQuery {
  return {
    search: state.search.trim() === "" ? null : state.search,
    playlistId: state.playlistId,
    browse: state.browse,
    sortBy: state.sortBy,
    direction: state.direction,
    offset: 0,
    limit: PAGE_SIZE,
  };
}

/** The order a view is in before anyone sorts it. */
function defaultSortFor(playlistId: number | null): SortField {
  // A playlist's own order is the point of it, so that is what it opens in;
  // the library has no inherent order and opens by artist.
  return playlistId === null ? "artist" : "position";
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  total: 0,
  stats: { tracks: 0, durationMs: 0, bytes: 0 },
  pages: new Map(),
  inFlight: new Set(),
  searchInput: "",
  search: "",
  playlistId: null,
  tab: "songs",
  browse: null,
  groups: [],
  groupsLoading: false,
  sortBy: "artist",
  direction: "asc",
  sortBeforeSearch: null,
  selection: emptySelection,
  loading: false,
  error: null,
  queryToken: 0,

  refresh: async () => {
    const token = get().queryToken + 1;
    // Pages are dropped before the count returns rather than after: they
    // belong to the previous query, and keeping them would show the old
    // results underneath a new search. The table renders placeholders in the
    // gap instead of blocking.
    set({
      queryToken: token,
      loading: true,
      error: null,
      pages: new Map(),
      inFlight: new Set(),
    });
    try {
      const stats = await libraryStats(queryFor(get()));
      // A superseded count is dropped, but `loading` is left alone rather than
      // cleared: the query that replaced this one owns it now, and clearing it
      // here would report "done" while that one is still running.
      if (get().queryToken !== token) {
        return;
      }
      set({ stats, total: stats.tracks, loading: false });
    } catch (cause) {
      if (get().queryToken !== token) {
        return;
      }
      set({ error: String(cause), loading: false });
    }
    await get().loadGroups(token);
  },

  /**
   * Reloads the open tab's group list.
   *
   * Shares `refresh`'s token rather than carrying its own, because the two
   * describe the same view: a search that narrows the rows narrows the albums,
   * and a stale group list arriving late would be as wrong as a stale page.
   */
  loadGroups: async (token) => {
    const { tab } = get();
    if (tab === "songs") {
      // Not merely skipped - cleared, so returning to a browse tab cannot show
      // the previous tab's groups for the moment before the query lands.
      set({ groups: [], groupsLoading: false });
      return;
    }

    set({ groupsLoading: true });
    try {
      // Deliberately not the drill-in query: the list of albums must not be
      // filtered by the album already open, or there would be no way back.
      const groups = await browseGroups({ ...queryFor(get()), browse: null }, tab);
      if (get().queryToken !== token) {
        return;
      }
      set({ groups, groupsLoading: false });
    } catch (cause) {
      if (get().queryToken !== token) {
        return;
      }
      set({ error: String(cause), groupsLoading: false });
    }
  },

  showPlaylist: async (playlistId) => {
    if (get().playlistId === playlistId) {
      return;
    }
    // Changing source resets the view rather than carrying the old sort and
    // search across: a search typed against the library is rarely the one you
    // want against a playlist, and the sorts are not even the same set - only
    // a playlist has a position to order by.
    runSearch.cancel();
    set({
      playlistId,
      searchInput: "",
      search: "",
      sortBy: defaultSortFor(playlistId),
      direction: "asc",
      sortBeforeSearch: null,
      selection: emptySelection,
      // A playlist's albums are not the library's, and the album that was open
      // is unlikely to be in it. Both are rebuilt by the refresh below.
      browse: null,
      groups: [],
    });
    await get().refresh();
  },

  showTab: async (tab) => {
    if (get().tab === tab) {
      return;
    }
    // The search survives a tab change, unlike a playlist change: "everything
    // matching «bear»" is a question you might want answered as songs and then
    // as albums, and re-typing it to switch view would be the annoying part.
    set({
      tab,
      browse: null,
      groups: [],
      selection: emptySelection,
    });
    await get().refresh();
  },

  openGroup: async (group) => {
    const { tab } = get();
    if (tab === "songs") {
      return;
    }
    set({
      browse: { kind: tab, key: group.key, secondary: group.secondary },
      selection: emptySelection,
      // An album reads in its own order rather than the library's default of
      // artist, which inside one album says nothing.
      sortBy: tab === "albums" ? "trackNo" : "artist",
      direction: "asc",
    });
    await get().refresh();
  },

  closeGroup: async () => {
    if (get().browse === null) {
      return;
    }
    set({ browse: null, selection: emptySelection, sortBy: "artist" });
    await get().refresh();
  },

  ensureRange: async (startIndex, endIndex) => {
    const { pages, inFlight, total, queryToken: token } = get();
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
            // Rows for a superseded query would otherwise be written into the
            // new query's page map and rendered as if they matched it.
            if (state.queryToken !== token) {
              return {};
            }
            const next = new Map(state.pages);
            next.set(page, rows);
            const stillInFlight = new Set(state.inFlight);
            stillInFlight.delete(page);
            return { pages: evictFarPages(next, visible), inFlight: stillInFlight };
          });
        } catch (cause) {
          set((state) => {
            if (state.queryToken !== token) {
              return {};
            }
            const stillInFlight = new Set(state.inFlight);
            stillInFlight.delete(page);
            return { error: String(cause), inFlight: stillInFlight };
          });
        }
      }),
    );
  },

  rowAt: (rowIndex) => rowAt(get().pages, rowIndex),

  setSearch: (search) => {
    set({ searchInput: search });
    runSearch();
  },

  commitSearch: async () => {
    runSearch.cancel();
    await applySearch(get().searchInput);
  },

  clearSearch: async () => {
    runSearch.cancel();
    set({ searchInput: "" });
    await applySearch("");
  },

  toggleSort: async (field) => {
    const { sortBy, direction } = get();
    set({
      sortBy: field,
      direction: sortBy === field && direction === "asc" ? "desc" : "asc",
      // Picking a column during a search is an explicit override, so clearing
      // the box must not undo it: there is nothing left to restore.
      sortBeforeSearch: null,
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

  queueIds: async () => {
    // Fetched fresh on each activation rather than cached: the ids have to
    // match the view's current sort and filter exactly, and a stale queue
    // would play the wrong track for the row that was clicked.
    try {
      return await allTrackIds(queryFor(get()));
    } catch (cause) {
      set({ error: String(cause) });
      return [];
    }
  },
}));

/**
 * Applies a committed search term.
 *
 * Starting a search switches the view to relevance ranking - the point of
 * searching is that the best match comes first - and clearing it restores the
 * column sort that was in use before, unless the user chose one meanwhile.
 */
async function applySearch(search: string): Promise<void> {
  const { search: previous, sortBy, direction, sortBeforeSearch } = useLibraryStore.getState();
  if (search === previous) {
    return;
  }

  const wasSearching = previous.trim() !== "";
  const nowSearching = search.trim() !== "";
  const next: Partial<LibraryState> = { search, selection: emptySelection };

  if (nowSearching && !wasSearching) {
    next.sortBeforeSearch = { sortBy, direction };
    next.sortBy = "relevance";
  } else if (!nowSearching && wasSearching) {
    if (sortBy === "relevance" && sortBeforeSearch) {
      next.sortBy = sortBeforeSearch.sortBy;
      next.direction = sortBeforeSearch.direction;
    }
    next.sortBeforeSearch = null;
  }

  useLibraryStore.setState(next);
  await useLibraryStore.getState().refresh();
}

const runSearch = debounce(() => {
  void applySearch(useLibraryStore.getState().searchInput);
}, SEARCH_DEBOUNCE_MS);

export { PAGE_SIZE, pageIndexOf };
