import { create } from "zustand";

/**
 * Where an update has got to.
 *
 * `ready` is the only state the user is asked to act on. Everything before it
 * happens quietly: a check that finds nothing, or fails because the machine is
 * offline, is not news.
 */
export type UpdateStatus = "idle" | "checking" | "downloading" | "ready" | "installing" | "failed";

/**
 * The parts of a Tauri `Update` this store uses, so tests can stand in for it.
 *
 * `download` and `install` are deliberately separate calls rather than the
 * plugin's combined `downloadAndInstall`. Downloading is safe to do unasked;
 * installing is not, because on Windows it hands off to the NSIS installer and
 * ends the process from under the running app - see `install` below.
 */
export interface UpdateHandle {
  version: string;
  download: () => Promise<void>;
  install: () => Promise<void>;
}

export interface UpdaterPorts {
  check: () => Promise<UpdateHandle | null>;
}

interface UpdaterState {
  status: UpdateStatus;
  /** The version waiting to be installed, once there is one. */
  version: string | null;
  error: string | null;
  /**
   * The downloaded update itself, held so `install` can apply the same one
   * that was fetched. The bytes live in the Rust resource behind it, so this
   * is a handle, not a payload - and it does not survive a quit.
   */
  update: UpdateHandle | null;

  /** Looks for an update and downloads it if there is one. */
  check: (ports: UpdaterPorts) => Promise<void>;
  /** Applies what was downloaded. */
  install: () => Promise<void>;
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: "idle",
  version: null,
  error: null,
  update: null,

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
      await update.download();
      set({ status: "ready", update });
    } catch (cause) {
      // Being offline is the ordinary case, not an error worth showing. The
      // state is kept so a retry is possible, but nothing is surfaced.
      set({ status: "failed", error: String(cause) });
    }
  },

  install: async () => {
    const update = get().update;
    if (get().status !== "ready" || update === null) {
      return;
    }
    set({ status: "installing" });
    try {
      // This does not return on Windows: the plugin hands the downloaded
      // installer to `ShellExecute` and then calls `std::process::exit(0)`, so
      // the app is gone before the promise could settle. The installer brings
      // it back on the new version. That is why nothing here relaunches, and
      // why this is only ever reached from a button the user pressed.
      await update.install();
    } catch (cause) {
      // It came back, so it failed. The download is still held, so the offer
      // stays up rather than disappearing with no explanation.
      set({ status: "ready", error: String(cause) });
    }
  },
}));
