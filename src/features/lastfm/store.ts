import type { UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { create } from "zustand";
import {
  lastfmBeginConnect,
  lastfmCompleteConnect,
  lastfmDisconnect,
  lastfmStatus,
  onLastfmDisconnected,
} from "../../ipc";

/** How often the browser trip is checked on. */
export const POLL_INTERVAL_MS = 2_000;

/**
 * How long to keep checking before giving up.
 *
 * Well inside the token's own hour: what runs out here is the user's patience,
 * not the token. Someone who closed the tab and walked away should not leave a
 * poll running for an hour, and someone who comes back later can press Connect
 * again — the cost of giving up early is one extra click.
 */
export const POLL_TIMEOUT_MS = 180_000;

interface LastfmState {
  /** Whether this build carries an API key at all. */
  configured: boolean;
  /** The connected account, or null. */
  username: string | null;
  /** Whether a browser trip is in progress. */
  connecting: boolean;
  error: string | null;

  /** Reads the stored status. Called once, at startup. */
  load: () => Promise<void>;
  /**
   * Listens for the backend forgetting a rejected key. Called once, at
   * startup; resolves to its own teardown.
   */
  watch: () => Promise<UnlistenFn>;
  connect: () => Promise<void>;
  /** Stops waiting on the browser. The token is simply abandoned. */
  cancelConnect: () => void;
  disconnect: () => Promise<void>;
  dismissError: () => void;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The last.fm account: whether there is one, and getting one.
 *
 * Its own store rather than a field on an existing one, for the same reason
 * the dynamic background has its own: it is a preference that outlives every
 * track, and only the Settings pane and the Account menu subscribe.
 *
 * **Off by default and inert until connected.** Nothing here calls out until
 * the user presses Connect; `load` reads the database.
 *
 * The poll cadence lives here rather than in Rust so that nothing in the
 * backend sleeps and the timing is testable against a mocked `ipc`. A
 * generation counter, not an abort signal: the loop checks whether it is still
 * the current attempt after every await, so Cancel and a second Connect both
 * retire the one before.
 */
let generation = 0;

export const useLastfmStore = create<LastfmState>((set) => ({
  configured: false,
  username: null,
  connecting: false,
  error: null,

  load: async () => {
    try {
      const status = await lastfmStatus();
      set({ configured: status.configured, username: status.username });
    } catch {
      // Left as "no key, no account", which is what an app that cannot read
      // the setting should offer: nothing.
    }
  },

  watch: () =>
    onLastfmDisconnected(() => {
      // Nothing the user did, so it is not a popover - but the Account menu is
      // claiming an account that no longer works, and the pane has to explain
      // why the connection went away on its own.
      generation += 1;
      set({
        username: null,
        connecting: false,
        error: "last.fm rejected the stored key. Connect again to keep scrobbling.",
      });
    }),

  connect: async () => {
    const attempt = ++generation;
    set({ connecting: true, error: null });

    try {
      const { token, authorizeUrl } = await lastfmBeginConnect();
      if (attempt !== generation) {
        return;
      }
      await openUrl(authorizeUrl);

      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await wait(POLL_INTERVAL_MS);
        if (attempt !== generation) {
          return;
        }
        const username = await lastfmCompleteConnect(token);
        if (attempt !== generation) {
          return;
        }
        if (username !== null) {
          set({ username, connecting: false });
          return;
        }
      }

      set({
        connecting: false,
        error: "last.fm was not authorised in time. Press Connect to try again.",
      });
    } catch (error) {
      if (attempt !== generation) {
        return;
      }
      set({ connecting: false, error: String(error) });
    }
  },

  cancelConnect: () => {
    generation += 1;
    set({ connecting: false });
  },

  disconnect: async () => {
    // Retires any poll in flight: disconnecting while waiting on the browser
    // would otherwise be undone by the attempt landing a moment later.
    generation += 1;
    try {
      await lastfmDisconnect();
      set({ username: null, connecting: false, error: null });
    } catch (error) {
      set({ error: String(error) });
    }
  },

  dismissError: () => set({ error: null }),
}));
