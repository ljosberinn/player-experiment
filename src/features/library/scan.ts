import { open } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import {
  addWatchFolder,
  type DropSummary,
  ingestDroppedPaths,
  onScanProgress,
  type ScanProgress,
  scanLibrary,
} from "../../ipc";
import { dismiss, report } from "../shell/statusStore";

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
  /** Asks for folders, adds them, and scans. Does nothing if the user cancels. */
  addFolder: () => Promise<void>;
  /** Takes the paths of one OS drop, and scans behind them. */
  drop: (paths: string[]) => Promise<void>;
  rescan: () => Promise<void>;
  /** Subscribes to `scan://progress`; returns its own teardown. */
  watch: () => Promise<() => void>;
}

/**
 * The one sentence a refused drop gets, however many files it refused.
 *
 * One per file would be one popover per file, and they all have the same
 * cause: nothing is watching where those files are, and there is no Library
 * folder to put them in either.
 */
function refusal({ refused }: DropSummary): string {
  return refused === 1
    ? "That file is not in a watched folder. Drop its folder instead, or turn on Organise My Library."
    : `Those ${refused} files are not in a watched folder. Drop their folders instead, or turn on Organise My Library.`;
}

export const useScanStore = create<ScanState>((set, get) => ({
  progress: null,
  busy: false,

  addFolder: async () => {
    if (get().busy) {
      return;
    }
    dismiss();
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
      report(cause);
    }
  },

  drop: async (paths) => {
    if (get().busy || paths.length === 0) {
      return;
    }
    dismiss();
    try {
      const summary = await ingestDroppedPaths(paths);
      // The scan is what makes rows: the command only leaves the filesystem in
      // a state where the scan sees what was dropped. Skipped when nothing
      // landed, so a drop of one refused file does not walk the library.
      if (summary.folders + summary.moved + summary.adopted > 0) {
        await get().rescan();
      }
      // After the scan, not before: `rescan` clears the popover as it starts.
      if (summary.refused > 0) {
        report(refusal(summary));
      }
    } catch (cause) {
      report(cause);
    }
  },

  rescan: async () => {
    // Not an error, and not worth saying: the user pressed F5 twice, or the
    // menu was open while a scan they started was still running.
    if (get().busy) {
      return;
    }
    dismiss();
    set({ busy: true });
    try {
      await scanLibrary();
    } catch (cause) {
      report(cause);
    } finally {
      set({ busy: false, progress: null });
    }
  },

  watch: async () => {
    // Progress arrives as events rather than by polling, and the library
    // refreshes once on completion above - refreshing per event would re-query
    // the count hundreds of times during a large import.
    return onScanProgress((progress) => set({ progress }));
  },
}));
