import { create } from "zustand";
import { loadDynamicBackground, saveDynamicBackground } from "../../ipc";

/**
 * Whether the background takes its colours from the playing cover.
 *
 * Its own store rather than a field on the player: it is a preference that
 * outlives any track, and the player store is rewritten wholesale by every
 * `player://state` event. A store of one boolean is also what keeps the
 * checkbox from re-rendering the app - only `DynamicBackground` and the
 * Settings dialog subscribe.
 *
 * On by default, because the design draws the blobs. The load below can only
 * ever turn it off, which is why a failure to read the setting is not worth
 * surfacing: the app looks the way it is meant to.
 */
interface DynamicBackgroundState {
  enabled: boolean;
  /** Reads the stored preference. Called once, at startup. */
  load: () => Promise<void>;
  set: (enabled: boolean) => Promise<void>;
  toggle: () => Promise<void>;
}

export const useDynamicBackgroundStore = create<DynamicBackgroundState>((set, get) => ({
  enabled: true,

  load: async () => {
    try {
      set({ enabled: await loadDynamicBackground() });
    } catch {
      // Nothing to do: `true` is the design, not a fallback.
    }
  },

  set: async (enabled) => {
    if (enabled === get().enabled) {
      return;
    }
    // Flipped locally first, so the checkbox answers the click rather than the
    // round trip. There is nothing to reconcile if the write fails - the
    // preference is whatever the user last asked for, and the next change
    // tries again.
    set({ enabled });
    try {
      await saveDynamicBackground(enabled);
    } catch {
      // Left showing what was asked for; see above.
    }
  },

  toggle: async () => {
    await get().set(!get().enabled);
  },
}));
