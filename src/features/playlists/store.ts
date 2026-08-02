import { create } from "zustand";
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  listPlaylists,
  moveInPlaylist,
  type Playlist,
  removeFromPlaylist,
  renamePlaylist,
} from "../../ipc";
import { useLibraryStore } from "../library/store";

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
  /** Creates a playlist and switches the view to it. */
  create: (name: string) => Promise<void>;
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
      await useLibraryStore.getState().showPlaylist(playlist.id);
    } catch (cause) {
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
