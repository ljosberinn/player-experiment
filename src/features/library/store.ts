import { create } from "zustand";
import {
  allTrackIds,
  type BrowseFilter,
  type BrowseGroup,
  type BrowseKind,
  type BuiltIn,
  browseGroups,
  forgetRemovedTracks,
  INVALIDATE_DEBOUNCE_MS,
  type LibraryStats,
  libraryStats,
  listPlaylists,
  loadColumnConfig,
  loadView,
  onLibraryChanged,
  type Playlist,
  queryTracks,
  type ReleaseGroup,
  releaseGroups,
  removeMissingTracks,
  removeTracks,
  resetAllColumnConfigs,
  type SortDirection,
  type SortField,
  saveColumnConfig,
  saveView,
  type Track,
  type TrackQuery,
} from "../../ipc";
import { debounce } from "../../lib/debounce";
import { dismiss, notify, report } from "../shell/statusStore";
import { type StatsPath, statsRoot } from "../stats/path";
import { albumIdentity } from "./browse";
import {
  type ColumnConfig,
  DEFAULT_COLUMN_CONFIG,
  displayedColumns,
  type FittedWidths,
  moveColumn,
  parseColumnConfig,
  pinsTrackNo,
  resizeColumn,
  serializeColumnConfig,
  toggleColumn,
  visibleSort,
} from "./columns";
import {
  currentEntry,
  forgetGroup as dropGroupEntry,
  forgetPlaylist as dropPlaylistEntries,
  goBack,
  goForward,
  type History,
  type HistoryEntry,
  historyAt,
  parseEntry,
  record as recordEntry,
  sameView,
  serializeEntry,
} from "./history";
import {
  evictFarPages,
  missingPages,
  PAGE_SIZE,
  type PageState,
  pageIndexOf,
  pagesForRange,
  rowAt,
  trackById,
} from "./pageCache";
import {
  applyClick,
  type ClickModifiers,
  emptySelection,
  type Selection,
  stepAnchor,
} from "./selection";

/**
 * How long typing has to pause before the search actually runs.
 *
 * Long enough that a normal typing rhythm produces one query instead of one
 * per keystroke; short enough not to feel laggy. The input itself never waits.
 */
export const SEARCH_DEBOUNCE_MS = 200;

/**
 * Which of the five views is open.
 *
 * Songs is the table; three are [`BrowseKind`], so the tab id is the grouping
 * rather than something that has to be mapped onto one; and Statistics reads
 * none of the library query the other four share.
 */
export type ViewTab = "songs" | BrowseKind | "stats";

/**
 * What each view is called, wherever one has to be named.
 *
 * Beside the type rather than in `App.tsx`, which used to own it: the history
 * arrows name their destination in a tooltip, and two lists of the same four
 * words would be two things to keep in step.
 */
export const VIEW_TITLES: Record<ViewTab, string> = {
  songs: "Songs",
  albums: "Releases",
  artists: "Artists",
  genres: "Genres",
  stats: "Statistics",
};

interface LibraryState {
  /** Total rows matching the current query; drives the scrollbar. */
  total: number;
  /**
   * Totals for the current view, for its summary.
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
  /** What the drilled-into group is called, as `HistoryEntry.browseLabel`. */
  browseLabel: string | null;
  /**
   * Where Statistics is pointed, or null outside it.
   *
   * Here rather than in `statsStore` for the reason `history` is here: the
   * path is navigation, it travels in a `HistoryEntry`, and a second store
   * holding a copy of it would be the drift that field's comment refuses.
   * `statsStore` holds what history deliberately does not - the filters.
   *
   * `App` does not subscribe to it, so a drill-down costs the shell nothing.
   */
  statsPath: StatsPath | null;
  /** The albums, artists or genres of the open browse tab. */
  groups: BrowseGroup[];
  groupsLoading: boolean;
  /**
   * The releases inside the open drill-in, and empty outside one.
   *
   * The opposite question to `groups`: that one is what the tab holds, this
   * one is what the view already open holds, so it keeps the browse filter
   * `groups` deliberately drops. Also what decides whether the table draws
   * itself as groups.
   *
   * Loaded beside `groups` and under the same token, because a search that
   * narrows the rows narrows these too and the row counts they carry are what
   * cuts the rows into groups - a stale list would index the wrong rows.
   */
  releases: ReleaseGroup[];
  /**
   * Which group each browse tab was last looking at.
   *
   * The index of the top group rather than a pixel offset: the window can be
   * resized while another tab is open, and an index survives a changed column
   * count where a pixel would point at a different album.
   *
   * Written by `BrowseView` on unmount and read by it on mount, never
   * subscribed to - scrolling must cost no render.
   */
  browseOffsets: Record<BrowseKind, number>;
  /**
   * Identifies the list `browseOffsets` describes.
   *
   * Clearing the offsets is enough for a tab that is closed, since it reads
   * them when it opens. The tab on screen has read them already, so it is told
   * instead: `BrowseView` watches this and places itself again whenever it
   * changes. Bumped in the same write that clears the offsets, never alone.
   */
  browseListToken: number;
  /**
   * Which columns this view shows, in what order, at what widths.
   *
   * Per view rather than global: `playlists.columns_json` has been in the
   * schema since phase 2, and a playlist of podcasts wants different columns
   * from the library.
   */
  columns: ColumnConfig;
  /**
   * Widths measured off the rows on screen when the view opened.
   *
   * Apart from `columns` because they are apart in kind: a `ColumnConfig` is
   * saved and belongs to the view for good, while these are recomputed on the
   * next navigation and never written anywhere.
   */
  fittedWidths: FittedWidths;
  /**
   * A navigation is waiting for rows to fit itself to.
   *
   * Raised by `applyEntry` rather than by `refresh`, which every sort toggle
   * and every debounced keystroke also reaches - and columns that resize while
   * typing are worse than columns that are too wide.
   */
  fitPending: boolean;
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
  /**
   * Identifies the query currently in flight.
   *
   * Every response checks it before writing: a page or a count belonging to a
   * query the user has already moved on from has to be dropped, not rendered.
   * Without this, a slow first search overwrites the results of a later one.
   */
  queryToken: number;
  /**
   * Where the user has been, and where they are in it.
   *
   * Here rather than in a store of its own: a second store holding a copy of
   * `tab`, `browse` and `playlistId` would drift out of step with the ones the
   * view actually reads.
   */
  history: History;
  /**
   * Which playlist ids are built-ins, told by the playlists store on each load.
   * Back and forward know a playlist only by id, and `showPlaylist` says why
   * this store does not go and ask.
   */
  builtIns: Partial<Record<number, BuiltIn>>;

  /** Records where a browse tab was left. See `browseOffsets`. */
  rememberBrowseOffset: (kind: BrowseKind, topGroup: number) => void;
  /** Reloads the count and drops cached pages; call after any query change. */
  refresh: () => Promise<void>;
  /**
   * Reloads on `library://changed`, debounced; returns its own teardown.
   *
   * What replaced every mutation reaching into this store to say what it
   * invalidated. A write announces itself and this re-asks; nothing has to
   * remember which views a given edit could have made wrong.
   */
  watch: () => Promise<() => void>;
  /**
   * Deletes every track whose file is gone, and reloads the view.
   *
   * Resolves to how many went. Leaves no tombstones - a drive coming back
   * should restore what was on it, unlike `removeFromLibrary`.
   */
  removeMissing: () => Promise<number>;
  /**
   * The rows a removal is waiting to be confirmed on, or null when none is.
   *
   * Here rather than in `App` because three routes ask the question - the row
   * menu, the File menu and Delete - and the last of those is a window-level
   * shortcut with no props to be handed a setter through.
   */
  pendingRemoval: number[] | null;
  /** Asks to remove `trackIds` from the library. Ignores an empty list. */
  askRemoval: (trackIds: number[]) => void;
  cancelRemoval: () => void;
  /**
   * Deletes the named rows and tombstones their paths. Resolves to how many
   * went.
   *
   * Destructive in a way `removeMissing` is not: those files are still on
   * disk and still under a watch folder, so the removal has to outlive a
   * rescan - which is what makes `forgetRemoved` the only way back.
   */
  removeFromLibrary: (trackIds: number[]) => Promise<number>;
  /** Drops the tombstones, so the next rescan re-adds those files. */
  forgetRemoved: () => Promise<void>;
  /** Reloads the open tab's groups under `refresh`'s token. Internal. */
  loadGroups: (token: number) => Promise<void>;
  /**
   * Switches the view to a playlist, or back to the whole library.
   *
   * Takes the row rather than the id because the landing tab depends on the
   * kind, and the library store has no business reading the playlists store.
   */
  showPlaylist: (playlist: Playlist | null) => Promise<void>;
  /** Shows or hides one column, and persists the result for this view. */
  toggleColumn: (id: SortField) => Promise<void>;
  /** Reorders a column by dragging its header. */
  moveColumn: (id: SortField, toIndex: number) => Promise<void>;
  /** Resizes a column by dragging its divider. */
  resizeColumn: (id: SortField, width: number) => Promise<void>;
  /** Puts the columns back to the defaults for this view. */
  resetColumns: () => Promise<void>;
  /**
   * Forgets the layout of every view, the library's and each playlist's, and
   * shows the defaults here.
   */
  resetAllColumns: () => Promise<void>;
  /**
   * Fits the visible columns to `widths`, consuming the pending flag.
   *
   * One `set`, no save and no refresh: a width cannot move the sort, so
   * `applyColumns` has nothing to offer here and five columns would otherwise
   * be five writes of a config that must not be written at all.
   */
  fitColumns: (widths: FittedWidths) => void;
  /** Reads the stored layout for the current view. Internal. */
  loadColumns: () => Promise<void>;
  /** Stores a column change and re-queries if it moved the sort. Internal. */
  applyColumns: (config: ColumnConfig) => Promise<void>;
  /**
   * Opens one of the four library views, leaving any playlist that is open.
   *
   * Both halves, because the sidebar merged the two controls: picking Songs
   * while a playlist is showing has to leave the playlist as well as choose
   * the view.
   */
  showTab: (tab: ViewTab) => Promise<void>;
  /** Drills, or walks a breadcrumb, inside Statistics. */
  showStatsPath: (path: StatsPath) => Promise<void>;
  /** Drills into one album, artist or genre from the open browse tab. */
  openGroup: (group: BrowseGroup) => Promise<void>;
  /**
   * Opens the album a track belongs to, its artist if it has no album, and
   * Songs if it has neither.
   *
   * Its own action rather than a tab change followed by `openGroup`: that pair
   * would refresh twice, and `openGroup` returns early on the Songs tab, so
   * the order that avoids the no-op is the order that queries twice.
   */
  showTrackGroup: (track: Track) => Promise<void>;
  /**
   * Opens the artist a track is filed under - its album artist, else its
   * artist - even where it has an album. Does nothing if it names neither.
   */
  showTrackArtist: (track: Track) => Promise<void>;
  /** Returns from a drill-in to the group list. */
  closeGroup: () => Promise<void>;
  /**
   * Opens the view the last session was showing, then runs the first query.
   *
   * What launch calls instead of `loadColumns` and `refresh`, which it runs
   * itself: restoring after them would query the library twice.
   */
  restoreView: () => Promise<void>;
  /** Moves the view to `entry` and stores `history` with it. Internal. */
  applyEntry: (entry: HistoryEntry, history: History) => Promise<void>;
  /** Returns to the previously visited view. Does nothing at the start. */
  back: () => Promise<void>;
  /** Undoes a `back`. Does nothing once the history has been branched. */
  forward: () => Promise<void>;
  /** Drops a deleted playlist's entries, so back cannot land on one. */
  forgetPlaylist: (playlistId: number) => void;
  setBuiltIns: (playlists: Playlist[]) => void;
  ensureRange: (startIndex: number, endIndex: number) => Promise<void>;
  rowAt: (rowIndex: number) => Track | null;
  /** A cached row by id, for the menu bar, which knows a selection by id. */
  trackById: (id: number) => Track | null;
  /** Types into the search box; the query itself is debounced. */
  setSearch: (search: string) => void;
  /** Runs the pending search now, for Enter. */
  commitSearch: () => Promise<void>;
  clearSearch: () => Promise<void>;
  toggleSort: (field: SortField) => Promise<void>;
  clickRow: (rowIndex: number, id: number, modifiers: ClickModifiers) => void;
  /**
   * Moves the selection one row, and answers where it went so the caller can
   * scroll and focus that row.
   *
   * Answers synchronously and writes the selection later, because the two
   * halves need different things: scrolling and focusing need only an index,
   * while the selection is ids and the target row's page may not be cached.
   * Waiting for the id before scrolling would stall the list on a fetch.
   */
  moveAnchor: (delta: -1 | 1) => number | null;
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
    // The Statistics view's slot, not the table's: nothing in the library
    // drills into a genre subtree, and the Genres tab is `browse`.
    genre: null,
    sortBy: state.sortBy,
    direction: state.direction,
    offset: 0,
    limit: PAGE_SIZE,
  };
}

type Sort = { sortBy: SortField; direction: SortDirection };

/** The order each built-in is locked to, as `db::playlists::definition` stores it. */
const BUILT_IN_SORT: Record<BuiltIn, Sort> = {
  favorites: { sortBy: "artist", direction: "asc" },
  mostPlayed: { sortBy: "playCount", direction: "desc" },
  recentlyAdded: { sortBy: "addedAt", direction: "desc" },
};

/** The sort `playlistId` is locked to, or null for any view the user can sort. */
function lockedSort(state: Pick<LibraryState, "builtIns">, playlistId: number | null): Sort | null {
  const builtIn = playlistId === null ? undefined : state.builtIns[playlistId];
  return builtIn === undefined ? null : BUILT_IN_SORT[builtIn];
}

/** The sort to keep under `config`: `visibleSort`, except that a lock holds. */
function sortUnder(state: LibraryState, config: ColumnConfig, sortBy: SortField): SortField {
  return lockedSort(state, state.playlistId) === null
    ? visibleSort(displayedColumns(config, state.browse), sortBy)
    : sortBy;
}

/**
 * Where the current view's layout is stored: its own playlist's row, or the
 * library's for a built-in, which has no layout of its own.
 */
function layoutOwner(state: LibraryState): number | null {
  return lockedSort(state, state.playlistId) === null ? state.playlistId : null;
}

/** The order a view is in before anyone sorts it. */
function defaultSortFor(playlistId: number | null): SortField {
  // A playlist's own order is the point of it, so that is what it opens in;
  // the library has no inherent order and opens by artist.
  return playlistId === null ? "artist" : "position";
}

/**
 * The sort a view opens in.
 *
 * Derived from the entry rather than stored in it. Storing it would mean going
 * back into an album landed in whatever order the previous visit happened to
 * end in - artist, say, which inside one album says nothing - instead of the
 * order the view is for.
 */
function sortForEntry(
  state: LibraryState,
  entry: HistoryEntry,
  crossesPlaylist: boolean,
): Partial<LibraryState> {
  const locked = lockedSort(state, entry.playlistId);
  if (locked !== null) {
    return { ...locked, sortBeforeSearch: null };
  }
  const opensRelease = pinsTrackNo(entry.browse);
  const opensIn: SortField = opensRelease ? "trackNo" : defaultSortFor(entry.playlistId);

  // A search does not survive a playlist change, so a move that crosses one is
  // never the searching case however the box looked a moment ago.
  const searching = !crossesPlaylist && state.search.trim() !== "";
  // A release reads as a tracklist whatever the search ranked or clicked.
  if (!searching || opensRelease) {
    return { sortBy: opensIn, direction: "asc", sortBeforeSearch: null };
  }
  // A column chosen during the search is an explicit override; there is
  // nothing left to restore and nothing to re-point. Not the `#` of a release
  // being left, which is the release's own order rather than a choice.
  const leavesReleaseOrder = pinsTrackNo(state.browse) && state.sortBy === "trackNo";
  if (state.sortBy !== "relevance" && !leavesReleaseOrder) {
    return { sortBy: visibleSort(displayedColumns(state.columns, entry.browse), state.sortBy) };
  }
  // Relevance ranking survives the move - the term is still on screen and
  // still the question being asked - but clearing the box now lands in the
  // natural order of the view being entered rather than the one being left.
  return { sortBy: "relevance", sortBeforeSearch: { sortBy: opensIn, direction: "asc" } };
}

/**
 * Every browse tab at the top, which is where a changed set of groups puts
 * them: a remembered position into a list that is no longer the same list
 * means nothing.
 */
const NO_BROWSE_OFFSETS: Record<BrowseKind, number> = { albums: 0, artists: 0, genres: 0 };

/**
 * Forgets every browse offset, and says so to the tab on screen.
 *
 * One helper for both callers so the token cannot part company with the
 * offsets it identifies. See `browseListToken`.
 */
function forgetBrowseOffsets(state: LibraryState): Partial<LibraryState> {
  return { browseOffsets: NO_BROWSE_OFFSETS, browseListToken: state.browseListToken + 1 };
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  total: 0,
  stats: { tracks: 0, durationMs: 0, bytes: 0, missing: 0, removed: 0 },
  pages: new Map(),
  inFlight: new Set(),
  searchInput: "",
  search: "",
  playlistId: null,
  tab: "songs",
  browse: null,
  browseLabel: null,
  statsPath: null,
  groups: [],
  groupsLoading: false,
  releases: [],
  browseOffsets: NO_BROWSE_OFFSETS,
  browseListToken: 0,
  columns: DEFAULT_COLUMN_CONFIG,
  fittedWidths: {},
  fitPending: false,
  sortBy: "artist",
  direction: "asc",
  sortBeforeSearch: null,
  selection: emptySelection,
  loading: false,
  builtIns: {},
  queryToken: 0,
  // Seeded with the view the app opens in, so the first navigation has
  // somewhere to go back to.
  history: historyAt({
    tab: "songs",
    browse: null,
    browseLabel: null,
    playlistId: null,
    stats: null,
  }),

  rememberBrowseOffset: (kind, topGroup) => {
    set((state) => ({ browseOffsets: { ...state.browseOffsets, [kind]: topGroup } }));
  },

  refresh: async () => {
    // Nothing on screen reads the library query while Statistics is open, and
    // `library://changed` fires throughout an import and a resolve. Leaving
    // re-queries, in `applyEntry`.
    if (get().tab === "stats") {
      return;
    }
    const token = get().queryToken + 1;
    dismiss();
    // Pages are dropped before the count returns rather than after: they
    // belong to the previous query, and keeping them would show the old
    // results underneath a new search. The table renders placeholders in the
    // gap instead of blocking.
    set({
      queryToken: token,
      loading: true,
      pages: new Map(),
      inFlight: new Set(),
    });
    // Local, because the message it stands for no longer lives here: what the
    // drill-in check below needs to know is whether the count it is about to
    // trust actually arrived.
    let counted = true;
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
      counted = false;
      report(cause);
      set({ loading: false });
    }
    await get().loadGroups(token);

    const state = get();
    // A drill-in that lands empty here means the group itself is gone - tags
    // changed, its last file went missing, a rescan - not that a search found
    // nothing inside a group that still exists. `search` is what tells the two
    // apart, and the token check is what keeps a superseded refresh from
    // ejecting a view a newer one has already replaced.
    if (
      state.queryToken === token &&
      counted &&
      state.browse !== null &&
      state.search.trim() === "" &&
      state.total === 0
    ) {
      const dead: HistoryEntry = {
        tab: state.tab,
        browse: state.browse,
        browseLabel: state.browseLabel,
        playlistId: state.playlistId,
        stats: null,
      };
      // Not `pushEntry`: that would leave Back pointing right at the dead
      // group. Dropping its entry instead is what `forgetPlaylist` does for a
      // deleted playlist, so Back and Forward skip over it like it never
      // happened.
      set({
        browse: null,
        browseLabel: null,
        selection: emptySelection,
        history: dropGroupEntry(state.history, dead),
      });
      storeView({ ...dead, browse: null, browseLabel: null });
    }
  },

  watch: async () => {
    // Debounced around the event rather than inside `refresh`, so a burst
    // collapses into one reload instead of one per emission.
    const reload = debounce(() => void get().refresh(), INVALIDATE_DEBOUNCE_MS);
    const off = await onLibraryChanged(reload);
    return () => {
      reload.cancel();
      off();
    };
  },

  removeMissing: async () => {
    try {
      const removed = await removeMissingTracks();
      // Through `refresh` rather than by patching `stats`: the rows are gone,
      // so every page, count and group in the view is now wrong, and the
      // playlist a row belonged to has lost an entry too.
      await get().refresh();
      return removed;
    } catch (cause) {
      report(cause);
      return 0;
    }
  },

  pendingRemoval: null,

  askRemoval: (trackIds) => {
    if (trackIds.length > 0) {
      set({ pendingRemoval: trackIds });
    }
  },

  cancelRemoval: () => set({ pendingRemoval: null }),

  removeFromLibrary: async (trackIds) => {
    if (trackIds.length === 0) {
      return 0;
    }
    try {
      const removed = await removeTracks(trackIds);
      // Selection first: the ids it names are gone, and `refresh` would
      // otherwise leave a selection pointing at nothing behind it.
      set({ selection: emptySelection });
      await get().refresh();
      return removed;
    } catch (cause) {
      report(cause);
      return 0;
    }
  },

  forgetRemoved: async () => {
    try {
      const forgotten = await forgetRemovedTracks();
      // Nothing comes back until a scan looks again, so the notice says so
      // rather than leaving the user to wonder why the table did not change.
      notify(
        `Forgot ${forgotten} removed song${forgotten === 1 ? "" : "s"}. Rescan to add them back.`,
      );
    } catch (cause) {
      report(cause);
    }
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
    if (tab === "songs" || tab === "stats") {
      // Not merely skipped - cleared, so returning to a browse tab cannot show
      // the previous tab's groups for the moment before the query lands.
      set({ groups: [], groupsLoading: false, releases: [] });
      return;
    }

    set({ groupsLoading: true });
    try {
      // Deliberately not the drill-in query: the list of albums must not be
      // filtered by the album already open, or there would be no way back.
      const query = queryFor(get());
      const groups = await browseGroups({ ...query, browse: null }, tab);
      // The drill-in's own list, which keeps the filter the line above drops.
      // Not asked for outside one: there is no drill-in to describe, and an
      // empty list is what tells the table to draw flat.
      const releases = query.browse === null ? [] : await releaseGroups(query);
      if (get().queryToken !== token) {
        return;
      }
      set({ groups, groupsLoading: false, releases });
    } catch (cause) {
      if (get().queryToken !== token) {
        return;
      }
      report(cause);
      set({ groupsLoading: false });
    }
  },

  showPlaylist: async (playlist) => {
    const playlistId = playlist?.id ?? null;
    // Clicking the playlist that is already open is a no-op rather than a
    // hidden way out of a drill-in, the same rule the browse tabs follow.
    if (get().playlistId === playlistId) {
      return;
    }
    // A playlist's albums are not the library's, and the album that was open
    // is unlikely to be in it, so the drill-in goes with the source.
    await pushEntry({
      tab: landingTab(get().tab, playlist),
      browse: null,
      browseLabel: null,
      playlistId,
      stats: null,
    });
  },

  loadColumns: async () => {
    const { playlistId } = get();
    const owner = layoutOwner(get());
    try {
      const stored = await loadColumnConfig(owner);
      // A playlist that has never been configured inherits the library's
      // layout rather than opening bare - any layout beats no columns.
      const config =
        stored === null && owner !== null
          ? parseColumnConfig(await loadColumnConfig(null))
          : parseColumnConfig(stored);
      // The view may have changed while this was in flight.
      if (get().playlistId !== playlistId) {
        return;
      }
      set({ columns: config, sortBy: sortUnder(get(), config, get().sortBy) });
    } catch {
      // A layout that will not load is not worth an error banner over the
      // table; the defaults are a working table.
      set({ columns: DEFAULT_COLUMN_CONFIG });
    }
  },

  /**
   * Applies a column change, persists it, and re-queries only if it moved the
   * sort - which hiding the sorted column does.
   */
  applyColumns: async (config) => {
    const previousSort = get().sortBy;
    const sortBy = sortUnder(get(), config, previousSort);
    set({ columns: config, sortBy });

    try {
      await saveColumnConfig(layoutOwner(get()), serializeColumnConfig(config));
    } catch (cause) {
      // Worth saying: the layout is on screen, so silence would look like it
      // saved and it would be gone next launch.
      report(cause);
    }

    if (sortBy !== previousSort) {
      await get().refresh();
    }
  },

  toggleColumn: async (id) => {
    await get().applyColumns(toggleColumn(get().columns, id));
  },

  moveColumn: async (id, toIndex) => {
    await get().applyColumns(moveColumn(get().columns, id, toIndex));
  },

  resizeColumn: async (id, width) => {
    await get().applyColumns(resizeColumn(get().columns, id, width));
  },

  resetColumns: async () => {
    // The fit goes with the config, or "Reset Columns" appears to do nothing
    // at all to the columns that were fitted.
    set({ fittedWidths: {} });
    await get().applyColumns(DEFAULT_COLUMN_CONFIG);
  },

  resetAllColumns: async () => {
    try {
      await resetAllColumnConfigs();
    } catch (cause) {
      report(cause);
      return;
    }
    // Not through `applyColumns`: saving the defaults for this view would give
    // it a layout of its own again, and it should inherit like every other.
    const previousSort = get().sortBy;
    const sortBy = sortUnder(get(), DEFAULT_COLUMN_CONFIG, previousSort);
    set({ columns: DEFAULT_COLUMN_CONFIG, fittedWidths: {}, sortBy });
    if (sortBy !== previousSort) {
      await get().refresh();
    }
  },

  fitColumns: (widths) => set({ fittedWidths: widths, fitPending: false }),

  showTab: async (tab) => {
    // Clicking the open tab again is a no-op, not a hidden way out of a
    // drill-in - the breadcrumb is what leads out of one. Inside a playlist it
    // is not a no-op even for the same tab: the playlist is what has to go.
    if (get().tab === tab && get().playlistId === null) {
      return;
    }
    // The search survives a tab change, unlike a playlist change: "everything
    // matching «bear»" is a question you might want answered as songs and then
    // as albums, and re-typing it to switch view would be the annoying part.
    await pushEntry({
      tab,
      browse: null,
      browseLabel: null,
      playlistId: null,
      // Listening rather than Library: the history is the half of this view
      // that the rest of the app cannot already answer.
      stats: tab === "stats" ? statsRoot("listening") : null,
    });
  },

  showStatsPath: async (path) => {
    await pushEntry({
      tab: "stats",
      browse: null,
      browseLabel: null,
      playlistId: null,
      stats: path,
    });
  },

  openGroup: async (group) => {
    const { tab, playlistId } = get();
    // Neither Songs nor Statistics has groups to drill into. The guard is here
    // rather than in `applyEntry`, which has to be able to set a tab and a
    // filter at once.
    if (tab === "songs" || tab === "stats") {
      return;
    }
    await pushEntry({
      tab,
      browse: { kind: tab, id: group.id },
      browseLabel: group.key,
      playlistId,
      stats: null,
    });
  },

  showTrackGroup: async (track) => {
    await pushEntry(entryForTrack(track));
  },

  showTrackArtist: async (track) => {
    const artist = tagged(track.album_artist) ?? tagged(track.artist);
    if (artist === null) {
      return;
    }
    await pushEntry({
      tab: "artists",
      browse: { kind: "artists", id: artist },
      browseLabel: artist,
      playlistId: null,
      stats: null,
    });
  },

  closeGroup: async () => {
    const { tab, browse, playlistId } = get();
    if (browse === null) {
      return;
    }
    await pushEntry({ tab, browse: null, browseLabel: null, playlistId, stats: null });
  },

  restoreView: async () => {
    const launched = get().history;
    let entry: HistoryEntry | null = null;
    try {
      entry = parseEntry(await loadView());
      if (entry?.playlistId != null) {
        // Read here rather than waiting on the playlists store: a built-in's
        // sort and layout both hang off `builtIns`, and they have to be known
        // before the first query rather than corrected by a second.
        const playlists = await listPlaylists();
        get().setBuiltIns(playlists);
        if (!playlists.some((playlist) => playlist.id === entry?.playlistId)) {
          // Where deleting the open playlist lands, as `showPlaylist(null)`.
          entry = { ...entry, playlistId: null, browse: null, browseLabel: null };
        }
      }
    } catch {
      // The view is a convenience; Songs is a working window.
      entry = null;
    }
    // Anything clicked while the reads were in flight wins over the restore.
    if (entry !== null && get().history === launched) {
      set({
        tab: entry.tab,
        browse: entry.browse,
        browseLabel: entry.browseLabel,
        statsPath: entry.stats,
        playlistId: entry.playlistId,
        // Back has nowhere to go: the last session's history is not restored.
        history: historyAt(entry),
        // Up front for the reason `applyEntry` gives.
        groupsLoading: entry.tab !== "songs" && entry.tab !== "stats",
        ...sortForEntry(get(), entry, false),
      });
    }
    // The layout before the query: it can move the sort off a hidden column.
    await get().loadColumns();
    // An emptied drill-in is left the way one emptied mid-session is, by the
    // check at the end of this.
    await get().refresh();
  },

  applyEntry: async (entry, history) => {
    const state = get();
    // Every navigation lands here, including the ones that only look like a
    // no-op - clicking the open tab, or a back that would not move.
    if (
      sameView(
        {
          tab: state.tab,
          browse: state.browse,
          browseLabel: state.browseLabel,
          playlistId: state.playlistId,
          stats: state.statsPath,
        },
        entry,
      )
    ) {
      return;
    }

    const crossesPlaylist = state.playlistId !== entry.playlistId;
    if (crossesPlaylist) {
      // A search typed against the library is rarely the one you want against
      // a playlist, and the sorts are not even the same set - only a playlist
      // has a position to order by.
      runSearch.cancel();
    }

    // Kept where they still describe the view - a drill-in and the list it
    // came from share one group list.
    const keepsGroups = state.tab === entry.tab && !crossesPlaylist;

    // One `set` for all of it, and one `refresh` after: every field here is
    // written today by an action that refreshes on its own, so replaying a
    // state by calling those actions would query once per field.
    set({
      history,
      tab: entry.tab,
      browse: entry.browse,
      browseLabel: entry.browseLabel,
      statsPath: entry.stats,
      playlistId: entry.playlistId,
      selection: emptySelection,
      // Dropped rather than held until the new fit lands: the outgoing widths
      // describe rows that are already gone.
      fittedWidths: {},
      fitPending: true,
      // Cleared unless they still describe the view, so a browse tab cannot
      // show the previous tab's groups while its own are in flight.
      groups: keepsGroups ? state.groups : [],
      // In the same `set` as the blanking above: with the flag still false the
      // browse view renders its empty state for a frame, which detaches the
      // scroll container it is about to be measured and restored through.
      groupsLoading: keepsGroups ? state.groupsLoading : true,
      ...sortForEntry(state, entry, crossesPlaylist),
      ...(crossesPlaylist
        ? {
            searchInput: "",
            search: "",
            sortBeforeSearch: null,
            // A playlist's albums are not the library's, so where the grid was
            // left describes a list that is not the one being opened.
            ...forgetBrowseOffsets(state),
          }
        : {}),
    });
    storeView(entry);

    if (crossesPlaylist) {
      // The layout belongs to the view, so it is reloaded rather than carried:
      // a playlist may have its own, and it may move the sort. Only across a
      // boundary, because columns are stored per playlist and nowhere else.
      await get().loadColumns();
    }
    // Statistics reads none of this: a move into it, and every drill-down
    // inside it, would otherwise re-count the library to draw numbers that
    // come from `plays`. The move back out is what re-queries - the same call,
    // one navigation later - which is also what `refresh`'s own guard leaves
    // to this one.
    if (entry.tab !== "stats") {
      await get().refresh();
    }
  },

  back: async () => {
    const moved = goBack(get().history);
    const entry = moved === null ? null : currentEntry(moved);
    if (moved === null || entry === null) {
      return;
    }
    await get().applyEntry(entry, moved);
  },

  forward: async () => {
    const moved = goForward(get().history);
    const entry = moved === null ? null : currentEntry(moved);
    if (moved === null || entry === null) {
      return;
    }
    await get().applyEntry(entry, moved);
  },

  forgetPlaylist: (playlistId) => {
    set((state) => ({ history: dropPlaylistEntries(state.history, playlistId) }));
  },

  setBuiltIns: (playlists) => {
    const builtIns: Partial<Record<number, BuiltIn>> = {};
    for (const playlist of playlists) {
      if (playlist.builtIn !== null) {
        builtIns[playlist.id] = playlist.builtIn;
      }
    }
    set({ builtIns });
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
          // Reported outside the updater: it is a cross-store write, and an
          // updater runs under zustand's own set.
          if (get().queryToken === token) {
            report(cause);
          }
          set((state) => {
            if (state.queryToken !== token) {
              return {};
            }
            const stillInFlight = new Set(state.inFlight);
            stillInFlight.delete(page);
            return { inFlight: stillInFlight };
          });
        }
      }),
    );
  },

  rowAt: (rowIndex) => rowAt(get().pages, rowIndex),

  trackById: (id) => trackById(get().pages, id),

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
    if (lockedSort(get(), get().playlistId) !== null) {
      return;
    }
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

  moveAnchor: (delta) => {
    const { selection, total, queryToken } = get();
    const target = stepAnchor(selection.anchorIndex, delta, total);
    if (target === null) {
      return null;
    }
    void selectWhenLoaded(target, selection.anchorIndex, queryToken);
    return target;
  },

  selectAll: async () => {
    // Ids, not rows: selecting everything must neither depend on what happens
    // to be cached nor be truncated by the backend's page cap.
    try {
      const ids = await allTrackIds(queryFor(get()));
      set({ selection: { ids: new Set(ids), anchorIndex: 0 } });
    } catch (cause) {
      report(cause);
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
      report(cause);
      return [];
    }
  },
}));

/**
 * Where a track lives in the library: its album, else its artist, else Songs.
 *
 * The tag rules are the browse query's, restated here because this builds the
 * filter that query will be given: an empty tag is an absent one, the album
 * artist names the group where there is one so a compilation opens as the
 * compilation rather than as the track's own artist, and the release group
 * MBID wins over both where the file carries one - which is why `Track` selects
 * a column no view renders. Building the id here rather than asking the backend
 * which tile holds this song keeps a round trip off a control the user pressed.
 *
 * The playlist goes: revealing what is playing means finding it in the
 * library, and a playlist the song is not in cannot show it.
 */
function entryForTrack(track: Track): HistoryEntry {
  const album = tagged(track.album);
  const artist = tagged(track.album_artist) ?? tagged(track.artist);
  const release = tagged(track.release_group_mbid);

  if (release !== null || album !== null) {
    return {
      tab: "albums",
      browse: { kind: "albums", id: release ?? albumIdentity(album, artist) },
      browseLabel: album,
      playlistId: null,
      stats: null,
    };
  }
  if (artist !== null) {
    return {
      tab: "artists",
      browse: { kind: "artists", id: artist },
      browseLabel: artist,
      playlistId: null,
      stats: null,
    };
  }
  return { tab: "songs", browse: null, browseLabel: null, playlistId: null, stats: null };
}

function tagged(value: string | null): string | null {
  return value === null || value.trim() === "" ? null : value;
}

/**
 * Which tab a source opens in.
 *
 * A built-in is a list in its own order, so it lands on the table. Any other
 * smart playlist is a question about the library and its answer reads as
 * releases, so it lands there whatever was open. Everything else carries the
 * open tab over, except Statistics: that is not a grouping a playlist can be
 * shown in, so opening one from there lands on the table.
 */
function landingTab(current: ViewTab, playlist: Playlist | null): ViewTab {
  if (playlist?.builtIn != null) {
    return "songs";
  }
  if (playlist?.kind === "smart") {
    return "albums";
  }
  return current === "stats" ? "songs" : current;
}

/**
 * Records `entry` and applies it.
 *
 * What every navigation but back and forward does, and the reason `applyEntry`
 * takes the history to store rather than a flag: those two have already moved
 * the index and must not push.
 */
async function pushEntry(entry: HistoryEntry): Promise<void> {
  const state = useLibraryStore.getState();
  await state.applyEntry(entry, recordEntry(state.history, entry));
}

/** Remembers `entry` for the next launch. A failed write costs only that. */
function storeView(entry: HistoryEntry): void {
  void saveView(serializeEntry(entry)).catch(() => {});
}

/**
 * Applies a committed search term.
 *
 * Starting a search switches the view to relevance ranking - the point of
 * searching is that the best match comes first - and clearing it restores the
 * column sort that was in use before, unless the user chose one meanwhile.
 */
async function applySearch(search: string): Promise<void> {
  const state = useLibraryStore.getState();
  const { search: previous, sortBy, direction, sortBeforeSearch } = state;
  if (search === previous) {
    return;
  }

  const wasSearching = previous.trim() !== "";
  const nowSearching = search.trim() !== "";
  // The term decides what is listed at all, so no browse tab is looking at the
  // groups it was left on.
  const next: Partial<LibraryState> = {
    search,
    selection: emptySelection,
    ...forgetBrowseOffsets(state),
  };

  // A built-in keeps its order while searching, as the backend does.
  const locked = lockedSort(state, state.playlistId) !== null;
  if (nowSearching && !wasSearching && !locked) {
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

/**
 * Makes `rowIndex` the selection once its page is there, unless the move was
 * overtaken first.
 *
 * Waits on the store rather than on `ensureRange`, which resolves at once for
 * a page already in flight - and after `moveAnchor`'s caller has scrolled to
 * the target, that is the usual case rather than the exception, because the
 * visible-range effect has just asked for the very page this needs.
 *
 * Overtaken means either a newer query - the row indices are into that query,
 * so they mean nothing against another - or an anchor that has moved on since,
 * which is a held arrow outrunning a fetch at a page boundary. Either way the
 * answer is to write nothing: a step is dropped, and the next keypress starts
 * from where the selection actually is.
 */
async function selectWhenLoaded(
  rowIndex: number,
  from: number | null,
  token: number,
): Promise<void> {
  const current = () => {
    const { selection, queryToken } = useLibraryStore.getState();
    return queryToken === token && selection.anchorIndex === from;
  };

  const { pages, ensureRange } = useLibraryStore.getState();
  let track = rowAt(pages, rowIndex);

  if (track === null) {
    void ensureRange(rowIndex, rowIndex);
    track = await new Promise<Track | null>((resolve) => {
      const page = pageIndexOf(rowIndex);
      const unsubscribe = useLibraryStore.subscribe((next) => {
        const landed = rowAt(next.pages, rowIndex);
        if (landed !== null) {
          unsubscribe();
          resolve(landed);
          return;
        }
        // Nothing left to wait for: either the move was overtaken, or the
        // fetch finished and produced no such row. Without this the
        // subscription would outlive a failed request forever.
        if (!current() || !next.inFlight.has(page)) {
          unsubscribe();
          resolve(null);
        }
      });
    });
  }

  // Re-read rather than trusting the check above: the cached path never
  // subscribed, and the awaited one resolves a microtask before this runs.
  if (track === null || !current()) {
    return;
  }
  useLibraryStore.setState({
    selection: { ids: new Set([track.id]), anchorIndex: rowIndex },
  });
}

export { PAGE_SIZE, pageIndexOf };
