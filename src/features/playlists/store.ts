import { create } from "zustand";
import {
  addToPlaylist,
  allTrackIds,
  createPlaylist,
  createSmartPlaylist,
  deletePlaylist,
  type FilterGroup,
  INVALIDATE_DEBOUNCE_MS,
  listPlaylists,
  loadSidebarSections,
  moveInPlaylist,
  onLibraryChanged,
  type Playlist,
  playlistFilter,
  playlistOrder,
  removeFromPlaylist,
  renamePlaylist,
  type SmartOrder,
  saveSidebarSections,
  setPlaylistFilter,
} from "../../ipc";
import { debounce } from "../../lib/debounce";
import { useLibraryStore } from "../library/store";
import { usePlayerStore } from "../player/store";
import { dismiss, notify, report } from "../shell/statusStore";
import { emptyFilter, noOrder } from "../smart/filterTree";
import {
  type Collapsed,
  parseSections,
  type SectionId,
  serialiseSections,
  toggleSection,
} from "./sections";

/** The name a brand new playlist gets, the way every music player does it. */
export const NEW_PLAYLIST_NAME = "New Playlist";

interface PlaylistsState {
  playlists: Playlist[];
  /** Which sidebar sections are folded away; see `sections.ts`. */
  collapsed: Collapsed;

  load: () => Promise<void>;
  /** Reads the stored sidebar arrangement. Called once, on mount. */
  loadSections: () => Promise<void>;
  /** Folds a section away or opens it, and remembers which. */
  toggleSection: (id: SectionId) => Promise<void>;
  /**
   * Recounts on `library://changed`, debounced; returns its own teardown.
   *
   * The counts beside each playlist are the reason: a scan that adds a
   * thousand songs changes what half of them say, and nothing else would tell
   * the sidebar so.
   */
  watch: () => Promise<() => void>;
  /**
   * The smart playlist being edited, if the editor is open.
   *
   * `playlistId: null` means "new"; the filter and order are what the dialog
   * opened with.
   */
  editing: {
    playlistId: number | null;
    name: string;
    filter: FilterGroup;
    order: SmartOrder;
  } | null;

  /**
   * Which playlist the sidebar should be renaming in place, if any.
   *
   * Lives in the store rather than in the sidebar because creating a playlist
   * is what usually starts a rename, and that happens elsewhere.
   */
  renaming: number | null;

  /** Creates a playlist and puts its new row straight into rename. */
  create: (name: string) => Promise<void>;
  /** Creates a playlist already holding `trackIds`, then renames it. */
  createFrom: (trackIds: number[]) => Promise<void>;
  startRename: (playlistId: number) => void;
  endRename: () => void;
  /** Opens the filter editor, on an existing smart playlist or a new one. */
  editSmart: (playlistId: number | null) => Promise<void>;
  closeEditor: () => void;
  /** Saves what the editor holds, creating the playlist if it is new. */
  saveSmart: (name: string, filter: FilterGroup, order: SmartOrder) => Promise<void>;
  rename: (playlistId: number, name: string) => Promise<void>;
  /** Deletes a playlist; the view falls back to the library if it was open. */
  remove: (playlistId: number) => Promise<void>;
  /** Drops a selection onto a playlist. */
  addTracks: (playlistId: number, trackIds: number[]) => Promise<void>;
  /** Takes tracks out of the playlist currently on screen. */
  removeTracks: (playlistId: number, trackIds: number[]) => Promise<void>;
  /** Reorders within the playlist currently on screen. */
  moveTracks: (playlistId: number, trackIds: number[], targetIndex: number) => Promise<void>;
  /** Opens a playlist and starts playing it from the top. */
  playPlaylist: (playlistId: number) => Promise<void>;
}

function nameOf(playlists: Playlist[], playlistId: number): string {
  return playlists.find((playlist) => playlist.id === playlistId)?.name ?? "the playlist";
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export const usePlaylistsStore = create<PlaylistsState>((set, get) => ({
  playlists: [],
  editing: null,
  renaming: null,
  collapsed: {},

  load: async () => {
    dismiss();
    try {
      set({ playlists: await listPlaylists() });
    } catch (cause) {
      report(cause);
    }
  },

  loadSections: async () => {
    try {
      set({ collapsed: parseSections(await loadSidebarSections()) });
    } catch {
      // A sidebar that cannot read its own arrangement opens every section,
      // which is the state it would have on a first run. Not worth the one
      // error popover the app has - nothing the user did has failed.
    }
  },

  toggleSection: async (id) => {
    const collapsed = toggleSection(get().collapsed, id);
    // On screen first, stored second: folding a section is a pointer gesture
    // and must not wait for SQLite to answer before it looks like it happened.
    set({ collapsed });
    try {
      await saveSidebarSections(serialiseSections(collapsed));
    } catch {
      // The sidebar is folded either way; only the memory of it is lost.
    }
  },

  watch: async () => {
    // Debounced *around* the event rather than inside `load`, so a burst
    // collapses into one reload rather than one per emission - which is the
    // whole point. `list_playlists` counts every playlist, and for a smart one
    // that means re-running its compiled filter.
    const recount = debounce(() => void get().load(), INVALIDATE_DEBOUNCE_MS);
    const off = await onLibraryChanged(recount);
    return () => {
      recount.cancel();
      off();
    };
  },

  create: async (name) => {
    try {
      const playlist = await createPlaylist(name);
      await get().load();
      // The view deliberately does not follow: a playlist created a moment ago
      // is empty, and switching to an empty view hides the songs you were
      // about to drag into it. Instead the new row goes straight into rename,
      // which is the only thing there is to do with it yet.
      set({ renaming: playlist.id });
    } catch (cause) {
      report(cause);
    }
  },

  createFrom: async (trackIds) => {
    if (trackIds.length === 0) {
      return;
    }
    try {
      const playlist = await createPlaylist(NEW_PLAYLIST_NAME);
      const added = await addToPlaylist(playlist.id, trackIds);
      await get().load();
      // The songs land before the rename starts, so what is being named is a
      // playlist that already holds something - and if the rename is abandoned
      // the drop is still not lost.
      set({ renaming: playlist.id });
      notify(`Added ${plural(added, "song")} to a new playlist.`);
    } catch (cause) {
      report(cause);
    }
  },

  startRename: (playlistId) => set({ renaming: playlistId }),
  endRename: () => set({ renaming: null }),

  editSmart: async (playlistId) => {
    if (playlistId === null) {
      set({
        editing: {
          playlistId: null,
          name: "New Smart Playlist",
          filter: emptyFilter,
          order: noOrder,
        },
      });
      return;
    }
    try {
      // Read the stored filter and order rather than trusting anything cached:
      // they are the pieces of a playlist the sidebar does not carry. Fetched
      // together so the editor cannot open on one playlist's rules beside
      // another's cutoff if the second call is slower than the first.
      const [filter, order] = await Promise.all([
        playlistFilter(playlistId),
        playlistOrder(playlistId),
      ]);
      set({
        editing: {
          playlistId,
          name: nameOf(get().playlists, playlistId),
          filter: filter ?? emptyFilter,
          order,
        },
      });
    } catch (cause) {
      report(cause);
    }
  },

  closeEditor: () => set({ editing: null }),

  saveSmart: async (name, filter, order) => {
    const editing = get().editing;
    if (editing === null) {
      return;
    }
    try {
      if (editing.playlistId === null) {
        const created = await createSmartPlaylist(name, filter, order);
        set({ editing: null });
        // Navigation, not invalidation: the new playlist has to be what is on
        // screen, and no event can say that.
        await useLibraryStore.getState().showPlaylist(created.id);
        return;
      }

      await setPlaylistFilter(editing.playlistId, filter, order);
      if (name !== editing.name) {
        await renamePlaylist(editing.playlistId, name);
      }
      set({ editing: null });
    } catch (cause) {
      // The editor stays open on a rejected filter, so the user can fix it
      // rather than losing what they built.
      report(cause);
    }
  },

  rename: async (playlistId, name) => {
    try {
      await renamePlaylist(playlistId, name);
    } catch (cause) {
      report(cause);
    }
  },

  remove: async (playlistId) => {
    try {
      await deletePlaylist(playlistId);
      // Both navigation: leave a playlist that no longer exists, and stop
      // offering it to Back. Neither is something an event can express, and
      // both run here rather than behind a debounce so the view is never
      // querying a dead id.
      if (useLibraryStore.getState().playlistId === playlistId) {
        await useLibraryStore.getState().showPlaylist(null);
      }
      useLibraryStore.getState().forgetPlaylist(playlistId);
    } catch (cause) {
      report(cause);
    }
  },

  addTracks: async (playlistId, trackIds) => {
    if (trackIds.length === 0) {
      return;
    }
    try {
      const added = await addToPlaylist(playlistId, trackIds);
      const name = nameOf(get().playlists, playlistId);
      // A playlist holds each track once, so a drop containing tracks it
      // already has adds fewer than were dragged. Saying so is more useful
      // than reporting the number the user dropped.
      const skipped = trackIds.length - added;
      notify(
        skipped > 0
          ? `Added ${plural(added, "song")} to ${name}; ${skipped} already there.`
          : `Added ${plural(added, "song")} to ${name}.`,
      );
    } catch (cause) {
      report(cause);
    }
  },

  removeTracks: async (playlistId, trackIds) => {
    if (trackIds.length === 0) {
      return;
    }
    try {
      const removed = await removeFromPlaylist(playlistId, trackIds);
      notify(`Removed ${plural(removed, "song")} from ${nameOf(get().playlists, playlistId)}.`);
      // Selection, not invalidation: the rows it names are gone.
      useLibraryStore.getState().clearSelection();
    } catch (cause) {
      report(cause);
    }
  },

  moveTracks: async (playlistId, trackIds, targetIndex) => {
    if (trackIds.length === 0) {
      return;
    }
    try {
      await moveInPlaylist(playlistId, trackIds, targetIndex);
    } catch (cause) {
      report(cause);
    }
  },

  playPlaylist: async (playlistId) => {
    try {
      // The ids are fetched for this playlist directly rather than read off
      // the current view: the view is switched in the same breath, and reading
      // it here would race that and play whatever was on screen before.
      const ids = await allTrackIds({
        search: null,
        playlistId,
        // The whole playlist, not whatever album the browse tab had open.
        browse: null,
        sortBy: "position",
        direction: "asc",
        offset: 0,
        limit: 0,
      });
      await useLibraryStore.getState().showPlaylist(playlistId);
      if (ids.length === 0) {
        notify(`${nameOf(get().playlists, playlistId)} is empty.`);
        return;
      }
      await usePlayerStore.getState().play(ids, 0);
    } catch (cause) {
      report(cause);
    }
  },
}));
