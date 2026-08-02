import { create } from "zustand";
import {
  addToPlaylist,
  createPlaylist,
  createSmartPlaylist,
  deletePlaylist,
  type FilterGroup,
  listPlaylists,
  moveInPlaylist,
  type Playlist,
  playlistFilter,
  removeFromPlaylist,
  renamePlaylist,
  setPlaylistFilter,
} from "../../ipc";
import { useLibraryStore } from "../library/store";
import { emptyFilter } from "../smart/filterTree";

/**
 * How long a drop confirmation stays on screen.
 *
 * Long enough to read a sentence, short enough that it is gone before it
 * becomes furniture. Dismissing it by hand is also possible.
 */
export const NOTICE_MS = 4000;

interface PlaylistsState {
  playlists: Playlist[];
  /** What the last drop or removal did, for a moment. */
  notice: string | null;
  error: string | null;

  load: () => Promise<void>;
  /**
   * The smart playlist being edited, if the editor is open.
   *
   * `playlistId: null` means "new"; the filter is what the dialog opened with.
   */
  editing: { playlistId: number | null; name: string; filter: FilterGroup } | null;

  /**
   * Which playlist the sidebar should be renaming in place, if any.
   *
   * Lives in the store rather than in the sidebar because creating a playlist
   * is what usually starts a rename, and that happens elsewhere.
   */
  renaming: number | null;

  /** Creates a playlist and puts its new row straight into rename. */
  create: (name: string) => Promise<void>;
  startRename: (playlistId: number) => void;
  endRename: () => void;
  /** Opens the filter editor, on an existing smart playlist or a new one. */
  editSmart: (playlistId: number | null) => Promise<void>;
  closeEditor: () => void;
  /** Saves what the editor holds, creating the playlist if it is new. */
  saveSmart: (name: string, filter: FilterGroup) => Promise<void>;
  rename: (playlistId: number, name: string) => Promise<void>;
  /** Deletes a playlist; the view falls back to the library if it was open. */
  remove: (playlistId: number) => Promise<void>;
  /** Drops a selection onto a playlist. */
  addTracks: (playlistId: number, trackIds: number[]) => Promise<void>;
  /** Takes tracks out of the playlist currently on screen. */
  removeTracks: (playlistId: number, trackIds: number[]) => Promise<void>;
  /** Reorders within the playlist currently on screen. */
  moveTracks: (playlistId: number, trackIds: number[], targetIndex: number) => Promise<void>;
  dismissNotice: () => void;
}

function nameOf(playlists: Playlist[], playlistId: number): string {
  return playlists.find((playlist) => playlist.id === playlistId)?.name ?? "the playlist";
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export const usePlaylistsStore = create<PlaylistsState>((set, get) => ({
  playlists: [],
  notice: null,
  error: null,
  editing: null,
  renaming: null,

  load: async () => {
    try {
      set({ playlists: await listPlaylists(), error: null });
    } catch (cause) {
      set({ error: String(cause) });
    }
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
      set({ error: String(cause) });
    }
  },

  startRename: (playlistId) => set({ renaming: playlistId }),
  endRename: () => set({ renaming: null }),

  editSmart: async (playlistId) => {
    if (playlistId === null) {
      set({ editing: { playlistId: null, name: "New Smart Playlist", filter: emptyFilter } });
      return;
    }
    try {
      // Read the stored filter rather than trusting anything cached: it is the
      // one piece of a playlist the sidebar does not carry.
      const filter = (await playlistFilter(playlistId)) ?? emptyFilter;
      set({
        editing: { playlistId, name: nameOf(get().playlists, playlistId), filter },
        error: null,
      });
    } catch (cause) {
      set({ error: String(cause) });
    }
  },

  closeEditor: () => set({ editing: null }),

  saveSmart: async (name, filter) => {
    const editing = get().editing;
    if (editing === null) {
      return;
    }
    try {
      if (editing.playlistId === null) {
        const created = await createSmartPlaylist(name, filter);
        set({ editing: null });
        await get().load();
        await useLibraryStore.getState().showPlaylist(created.id);
        return;
      }

      await setPlaylistFilter(editing.playlistId, filter);
      if (name !== editing.name) {
        await renamePlaylist(editing.playlistId, name);
      }
      set({ editing: null });
      await get().load();
      // Its membership is its filter, so a changed filter is a changed view -
      // there is nothing to recompute, only to re-ask.
      if (useLibraryStore.getState().playlistId === editing.playlistId) {
        await useLibraryStore.getState().refresh();
      }
    } catch (cause) {
      // The editor stays open on a rejected filter, so the user can fix it
      // rather than losing what they built.
      set({ error: String(cause) });
    }
  },

  rename: async (playlistId, name) => {
    try {
      await renamePlaylist(playlistId, name);
      await get().load();
    } catch (cause) {
      set({ error: String(cause) });
    }
  },

  remove: async (playlistId) => {
    try {
      await deletePlaylist(playlistId);
      // Order matters: the view has to leave a playlist that no longer exists
      // before the sidebar drops it, or the query runs against a dead id.
      if (useLibraryStore.getState().playlistId === playlistId) {
        await useLibraryStore.getState().showPlaylist(null);
      }
      await get().load();
    } catch (cause) {
      set({ error: String(cause) });
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
      set({
        notice:
          skipped > 0
            ? `Added ${plural(added, "song")} to ${name}; ${skipped} already there.`
            : `Added ${plural(added, "song")} to ${name}.`,
      });
      await get().load();
      if (useLibraryStore.getState().playlistId === playlistId) {
        await useLibraryStore.getState().refresh();
      }
    } catch (cause) {
      set({ error: String(cause) });
    }
  },

  removeTracks: async (playlistId, trackIds) => {
    if (trackIds.length === 0) {
      return;
    }
    try {
      const removed = await removeFromPlaylist(playlistId, trackIds);
      set({
        notice: `Removed ${plural(removed, "song")} from ${nameOf(get().playlists, playlistId)}.`,
      });
      useLibraryStore.getState().clearSelection();
      await get().load();
      await useLibraryStore.getState().refresh();
    } catch (cause) {
      set({ error: String(cause) });
    }
  },

  moveTracks: async (playlistId, trackIds, targetIndex) => {
    if (trackIds.length === 0) {
      return;
    }
    try {
      await moveInPlaylist(playlistId, trackIds, targetIndex);
      await useLibraryStore.getState().refresh();
    } catch (cause) {
      set({ error: String(cause) });
    }
  },

  dismissNotice: () => set({ notice: null }),
}));
