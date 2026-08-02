import { create } from "zustand";

/**
 * Where an update has got to.
 *
 * `ready` is the only state the user is asked to act on. Everything before it
 * happens quietly: a check that finds nothing, or fails because the machine is
 * offline, is not news.
 */
export type UpdateStatus = "idle" | "checking" | "downloading" | "ready" | "installing" | "failed";

/** The parts of the Tauri updater this store uses, so tests can stand in for it. */
export interface UpdateHandle {
  version: string;
  downloadAndInstall: (onEvent?: (event: { event: string }) => void) => Promise<void>;
}

export interface UpdaterPorts {
  check: () => Promise<UpdateHandle | null>;
  relaunch: () => Promise<void>;
}

interface UpdaterState {
  status: UpdateStatus;
  /** The version waiting to be installed, once there is one. */
  version: string | null;
  error: string | null;

  /** Looks for an update and downloads it if there is one. */
  check: (ports: UpdaterPorts) => Promise<void>;
  /** Installs what was downloaded and restarts into it. */
  install: (ports: UpdaterPorts) => Promise<void>;
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: "idle",
  version: null,
  error: null,

  check: async (ports) => {
    // A check already running, or an update already sitting ready, is not
    // something a timer tick should restart.
    if (get().status !== "idle" && get().status !== "failed") {
      return;
    }
    set({ status: "checking", error: null });
    try {
      const update = await ports.check();
      if (update === null) {
        set({ status: "idle" });
        return;
      }

      // Downloaded without asking. It is slow, it needs no decision, and
      // asking first only means the user waits after saying yes.
      set({ status: "downloading", version: update.version });
      await update.downloadAndInstall();
      set({ status: "ready" });
    } catch (cause) {
      // Being offline is the ordinary case, not an error worth showing. The
      // state is kept so a retry is possible, but nothing is surfaced.
      set({ status: "failed", error: String(cause) });
    }
  },

  install: async (ports) => {
    if (get().status !== "ready") {
      return;
    }
    set({ status: "installing" });
    try {
      await ports.relaunch();
    } catch (cause) {
      // The restart failed, but the update is still downloaded and will be
      // applied the next time the app is started by hand.
      set({ status: "ready", error: String(cause) });
    }
  },
}));
