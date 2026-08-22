import { create } from "zustand";
import { type ExportScope, exportLibrary, onExportProgress, type WriteProgress } from "../../ipc";

/**
 * Running an export, and watching it.
 *
 * A store rather than a closure in `App` for the reason `scan.ts` is one: the
 * work now reports progress, so something has to hold that progress and
 * subscribe to the channel it arrives on, and four call sites reach the same
 * export.
 *
 * Picking the file stays with the caller. A save dialog is the shell's
 * business, and the scope is already decided by the view before either happens.
 */
export interface ExportState {
  progress: WriteProgress | null;
  busy: boolean;
  /** Writes `scope` to `path`, resolving to how many tracks it holds. */
  run: (path: string, scope: ExportScope) => Promise<number>;
  /** Subscribes to `export://progress`; returns its own teardown. */
  watch: () => Promise<() => void>;
}

export const useExportStore = create<ExportState>((set) => ({
  progress: null,
  busy: false,

  run: async (path, scope) => {
    // Set before the first event so the readout appears when the save dialog
    // closes rather than once the first page of tracks has been read.
    set({ busy: true, progress: null });
    try {
      return await exportLibrary(path, scope);
    } finally {
      set({ busy: false, progress: null });
    }
  },

  watch: async () => {
    return onExportProgress((progress) => set({ progress }));
  },
}));
