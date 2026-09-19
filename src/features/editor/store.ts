import { create } from "zustand";
import {
  onTagWriteProgress,
  type TagEdit,
  type Track,
  tracksByIds,
  type WriteProgress,
  writeTags,
} from "../../ipc";
import { dismiss, notify, report } from "../shell/statusStore";

interface EditorState {
  /** The tracks the dialog is open on, or null when it is closed. */
  tracks: Track[] | null;
  /**
   * How far the write in flight has got, or null when none is.
   *
   * The dialog stays open while it runs. It used to sit there frozen, which
   * for 500 files was indistinguishable from a hung window - the whole reason
   * the write moved off the IPC thread.
   */
  progress: WriteProgress | null;

  /** Opens the editor on a selection. */
  open: (trackIds: number[]) => Promise<void>;
  close: () => void;
  save: (edit: TagEdit) => Promise<void>;
  /** Subscribes to `tags://progress`; returns its own teardown. */
  watch: () => Promise<() => void>;
}

/**
 * Turns a write summary into one line.
 *
 * Partial success is the interesting case and the one that must not be
 * silently rounded to "done": a read-only file in the middle of a large
 * selection is exactly what the user needs told.
 */
function describe(
  verb: string,
  summary: { written: number; failed: number; errors: string[] },
): string {
  const songs = `${summary.written} song${summary.written === 1 ? "" : "s"}`;
  if (summary.failed === 0) {
    return `${verb} ${songs}.`;
  }
  return `${verb} ${songs}; ${summary.failed} could not be written. ${summary.errors[0] ?? ""}`.trim();
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tracks: null,
  progress: null,

  open: async (trackIds) => {
    if (trackIds.length === 0) {
      return;
    }
    dismiss();
    try {
      // Fetched fresh rather than read from the page cache: the selection can
      // name rows that were evicted, and stale values would be written back.
      const tracks = await tracksByIds(trackIds);
      if (tracks.length > 0) {
        set({ tracks });
      }
    } catch (cause) {
      report(cause);
    }
  },

  close: () => set({ tracks: null }),

  save: async (edit) => {
    const tracks = get().tracks;
    if (tracks === null) {
      return;
    }
    // Set here rather than on the first event, so the dialog goes to work the
    // moment Save is pressed instead of when the first file lands.
    set({ progress: { done: 0, total: tracks.length } });
    try {
      const summary = await writeTags(
        tracks.map((track) => track.id),
        edit,
      );
      set({ tracks: null });
      notify(describe("Updated", summary));
    } catch (cause) {
      // The dialog stays open so a rejected edit can be corrected rather than
      // retyped.
      report(cause);
    } finally {
      set({ progress: null });
    }
  },

  watch: async () => {
    // Guarded on a save of this store's own being in flight - which is exactly
    // what a non-null `progress` means, since `save` sets it before it awaits.
    // `tags://progress` is one channel for every tag write and the lookup's
    // apply is the other sender on it, so an unconditional `set` left the
    // readout standing with nothing here to clear it: the next dialog to open
    // found Save disabled at "Saving…" and no way out but a restart. It also
    // drops the last event of the batch when that arrives after the command's
    // own reply - two messages over one bridge, in no fixed order.
    return onTagWriteProgress((progress) => {
      if (get().progress !== null) {
        set({ progress });
      }
    });
  },
}));
