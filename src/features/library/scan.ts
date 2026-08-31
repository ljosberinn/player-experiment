import { open } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { addWatchFolder, onScanProgress, type ScanProgress, scanLibrary } from "../../ipc";
import { useLibraryStore } from "./store";

/**
 * Adding folders and running scans.
 *
 * A store rather than component state since phase 34. Both actions used to live
 * inside `ScanBar`'s closure, which was fine while a button on that bar was the
 * only way to reach them; the File menu and F5 are two more, and three copies
 * of "open a dialog, add the folder, rescan" would be three things to keep in
 * step. `ScanBar` is now only the progress readout.
 *
 * `busy` is what stops a second scan starting on top of the first - the menu
 * item and the key both consult it, so holding F5 down cannot queue a hundred.
 */
export interface ScanState {
  progress: ScanProgress | null;
  busy: boolean;
  error: string | null;
  /** Asks for folders, adds them, and scans. Does nothing if the user cancels. */
  addFolder: () => Promise<void>;
  rescan: () => Promise<void>;
  dismissError: () => void;
  /** Subscribes to `scan://progress`; returns its own teardown. */
  watch: () => Promise<() => void>;
}

export const useScanStore = create<ScanState>((set, get) => ({
  progress: null,
  busy: false,
  error: null,

  addFolder: async () => {
    if (get().busy) {
      return;
    }
    set({ error: null });
    try {
      const selected = await open({ directory: true, multiple: true, title: "Add music folders" });
      if (!Array.isArray(selected) || selected.length === 0) {
        return;
      }
      for (const folder of selected) {
        await addWatchFolder(folder);
      }
      // One scan after the loop, not one per folder: a scan walks every watched
      // folder, so scanning per addition would walk the first one again for
      // each of the rest.
      await get().rescan();
    } catch (cause) {
      set({ error: String(cause) });
    }
  },

  rescan: async () => {
    // Not an error, and not worth saying: the user pressed F5 twice, or the
    // menu was open while a scan they started was still running.
    if (get().busy) {
      return;
    }
    set({ busy: true, error: null });
    try {
      await scanLibrary();
      await useLibraryStore.getState().refresh();
    } catch (cause) {
      set({ error: String(cause) });
    } finally {
      set({ busy: false, progress: null });
    }
  },

  dismissError: () => set({ error: null }),

  watch: async () => {
    // Progress arrives as events rather than by polling, and the library
    // refreshes once on completion above - refreshing per event would re-query
    // the count hundreds of times during a large import.
    return onScanProgress((progress) => set({ progress }));
  },
}));
