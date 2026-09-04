import { create } from "zustand";
import { type BackgroundTask, onTaskProgress } from "../../ipc";

/**
 * What long task is running, if any.
 *
 * One channel, one producer: looking a release up and moving it are two steps
 * of one pass rather than two passes, which is why this holds a task rather
 * than a list. The payload still carries its own label, because that label
 * names the steps that are switched on.
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
