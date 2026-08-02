import { create } from "zustand";
import {
  canUndoTagEdit,
  type TagEdit,
  type Track,
  tracksByIds,
  undoTagEdit,
  writeTags,
} from "../../ipc";
import { useLibraryStore } from "../library/store";

interface EditorState {
  /** The tracks the dialog is open on, or null when it is closed. */
  tracks: Track[] | null;
  /** Whether there is an edit to take back. */
  canUndo: boolean;
  notice: string | null;
  error: string | null;

  /** Opens the editor on a selection. */
  open: (trackIds: number[]) => Promise<void>;
  close: () => void;
  save: (edit: TagEdit) => Promise<void>;
  undo: () => Promise<void>;
  /** Reads whether an undo is available, for enabling the control. */
  refreshUndo: () => Promise<void>;
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
  canUndo: false,
  notice: null,
  error: null,

  open: async (trackIds) => {
    if (trackIds.length === 0) {
      return;
    }
    try {
      // Fetched fresh rather than read from the page cache: the selection can
      // name rows that were evicted, and stale values would be written back.
      const tracks = await tracksByIds(trackIds);
      if (tracks.length > 0) {
        set({ tracks, error: null });
      }
    } catch (cause) {
      set({ error: String(cause) });
    }
  },

  close: () => set({ tracks: null }),

  save: async (edit) => {
    const tracks = get().tracks;
    if (tracks === null) {
      return;
    }
    try {
      const summary = await writeTags(
        tracks.map((track) => track.id),
        edit,
      );
      set({ tracks: null, notice: describe("Updated", summary) });
      await get().refreshUndo();
      await useLibraryStore.getState().refresh();
    } catch (cause) {
      // The dialog stays open so a rejected edit can be corrected rather than
      // retyped.
      set({ error: String(cause) });
    }
  },

  undo: async () => {
    try {
      const summary = await undoTagEdit();
      set({ notice: describe("Reverted", summary) });
      await get().refreshUndo();
      await useLibraryStore.getState().refresh();
    } catch (cause) {
      set({ error: String(cause) });
    }
  },

  refreshUndo: async () => {
    try {
      set({ canUndo: await canUndoTagEdit() });
    } catch {
      // Not worth surfacing: the worst case is a control that stays disabled.
      set({ canUndo: false });
    }
  },
}));
