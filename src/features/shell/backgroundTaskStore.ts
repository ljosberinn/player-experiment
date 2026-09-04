import { create } from "zustand";
import { type BackgroundTask, onTaskProgress } from "../../ipc";

/**
 * What long task is running, if any.
 *
 * One channel with more than one producer: the unattended lookup pass is the
 * first and phase 83's library move is the second, which is why the payload
 * carries its own label. Two tasks cannot run at once - both take the scan
 * lock per write - so this holds one rather than a list.
 *
 * Nothing is asked for at startup. The producer says where it is per release,
 * and it says `null` when it stops, so the readout is empty until a task has
 * something to report and empty again the moment it has not.
 */
interface BackgroundTaskState {
  task: BackgroundTask | null;
  /** Subscribes to `task://progress`; returns its own teardown. */
  watch: () => Promise<() => void>;
}

export const useBackgroundTaskStore = create<BackgroundTaskState>((set) => ({
  task: null,

  watch: async () =>
    // Undebounced, unlike `library://changed`: this arrives once per release,
    // which for the lookup pass is once every twenty seconds, and it re-renders
    // one line.
    onTaskProgress((task) => set({ task })),
}));
