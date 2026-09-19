import type { UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { create } from "zustand";
import {
  type LastfmImport,
  lastfmBeginConnect,
  lastfmCompleteConnect,
  lastfmDisconnect,
  lastfmImport,
  lastfmLove,
  lastfmLovedTracks,
  lastfmStatus,
  onLastfmDisconnected,
  onLastfmImport,
  onLastfmQueued,
  type WriteProgress,
} from "../../ipc";
import { notify, report } from "../shell/statusStore";

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
  /** Plays recorded but not yet accepted by last.fm. Normally zero. */
  queued: number;
  error: string | null;
  /** Where the history import stands, or null if none has run. */
  imported: LastfmImport | null;
  /** Whether an import is running. */
  importing: boolean;
  /** How far the running import has got, or null before its first page. */
  importProgress: WriteProgress | null;
  /**
   * The library tracks last.fm holds a love for.
   *
   * Held whole rather than asked per row: a right-click menu has to say Love
   * or Unlove the instant it opens, and `rowMenuItems` is pure and
   * synchronous. Read with `getState()` where it is only needed at menu-build
   * time, so the table subscribes to nothing.
   */
  loved: ReadonlySet<number>;

  /** Reads the stored status. Called once, at startup. */
  load: () => Promise<void>;
  /**
   * Reads the loved set. Called at startup, after an import, and to recover
   * from a love that failed part-way.
   */
  loadLoved: () => Promise<void>;
  /**
   * Loves or unloves `trackIds`, answering in the UI before last.fm has
   * confirmed it.
   *
   * The set moves first and is replaced by what the backend answers with,
   * which is the whole set: two library rows can share one match key, and
   * loving either loves both. A refusal is reported — the user asked for
   * this — and the set is re-read rather than simply put back, because a
   * selection can fail part-way through.
   */
  love: (trackIds: number[], loved: boolean) => Promise<void>;
  /**
   * Listens for what the scrobbler thread decides on its own: a rejected key,
   * and how many plays are waiting. Called once, at startup; resolves to its
   * own teardown.
   */
  watch: () => Promise<UnlistenFn>;
  connect: () => Promise<void>;
  /** Stops waiting on the browser. The token is simply abandoned. */
  cancelConnect: () => void;
  disconnect: () => Promise<void>;
  dismissError: () => void;
  /**
   * Imports `username`'s history. `fresh` drops what earlier imports brought
   * in and starts from the top. A failure goes to the status popover, like any
   * other operation the user started.
   */
  importHistory: (username: string, fresh: boolean) => Promise<void>;
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

export const useLastfmStore = create<LastfmState>((set, get) => ({
  configured: false,
  username: null,
  connecting: false,
  queued: 0,
  error: null,
  imported: null,
  importing: false,
  importProgress: null,
  loved: new Set<number>(),

  load: async () => {
    try {
      const status = await lastfmStatus();
      set({
        configured: status.configured,
        username: status.username,
        queued: status.queued,
        imported: status.import,
      });
    } catch {
      // Left as "no key, no account", which is what an app that cannot read
      // the setting should offer: nothing.
    }
  },

  loadLoved: async () => {
    try {
      set({ loved: new Set(await lastfmLovedTracks()) });
    } catch {
      // Left as it was. Nobody asked for this read, and an empty set would
      // make every menu offer Love on a song the user has already loved.
    }
  },

  love: async (trackIds, loved) => {
    const before = get().loved;
    const optimistic = new Set(before);
    for (const id of trackIds) {
      if (loved) {
        optimistic.add(id);
      } else {
        optimistic.delete(id);
      }
    }
    set({ loved: optimistic });

    try {
      set({ loved: new Set(await lastfmLove(trackIds, loved)) });
    } catch (error) {
      report(error);
      set({ loved: before });
      // The backend stops at the first refusal and keeps whatever it had
      // already sent, so after a partial failure neither set is the truth.
      // Put it back, then ask; the read is what settles it.
      await get().loadLoved();
    }
  },

  watch: async () => {
    const stopDisconnected = await onLastfmDisconnected(() => {
      // Nothing the user did, so it is not a popover - but the Account menu is
      // claiming an account that no longer works, and the pane has to explain
      // why the connection went away on its own.
      generation += 1;
      set({
        username: null,
        connecting: false,
        error: "last.fm rejected the stored key. Connect again to keep scrobbling.",
      });
    });
    const stopQueued = await onLastfmQueued((queued) => set({ queued }));
    const stopImport = await onLastfmImport((importProgress) => set({ importProgress }));
    return () => {
      stopDisconnected();
      stopQueued();
      stopImport();
    };
  },

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
      // The queue is not cleared, and the count stays: those plays are still
      // recorded, and connecting the same account again sends them.
    } catch (error) {
      set({ error: String(error) });
    }
  },

  dismissError: () => set({ error: null }),

  importHistory: async (username, fresh) => {
    if (get().importing) {
      return;
    }
    set({ importing: true, importProgress: null });
    try {
      const { imported, state } = await lastfmImport(username, fresh);
      set({ imported: state });
      // The import replaces the loved set wholesale, so what the window holds
      // is stale the moment this returns.
      await get().loadLoved();
      notify(
        imported === 1
          ? "Imported 1 play from last.fm."
          : `Imported ${imported.toLocaleString()} plays from last.fm.`,
      );
    } catch (error) {
      report(error);
      // A run that stopped part-way still recorded where it got to, and the
      // pane offers to resume from there.
      try {
        set({ imported: (await lastfmStatus()).import });
      } catch {
        // Left as it was: the popover already says something went wrong.
      }
    } finally {
      set({ importing: false, importProgress: null });
    }
  },
}));
