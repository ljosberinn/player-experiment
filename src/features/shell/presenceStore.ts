import { create } from "zustand";
import { loadDiscordPresence, saveDiscordPresence } from "../../ipc";

/**
 * Whether Discord's status shows what is playing.
 *
 * Loaded when Settings opens, like the unattended lookup: the backend reads
 * the setting itself, and nothing else on screen draws from it.
 */
interface PresenceState {
  enabled: boolean;
  load: () => Promise<void>;
  set: (enabled: boolean) => Promise<void>;
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  enabled: false,

  load: async () => {
    try {
      set({ enabled: await loadDiscordPresence() });
    } catch {
      // Off is the safe answer: it publishes nothing.
    }
  },

  set: async (enabled) => {
    if (enabled === get().enabled) {
      return;
    }
    set({ enabled });
    try {
      await saveDiscordPresence(enabled);
    } catch {
      // Left showing what was asked for; the next change tries again.
    }
  },
}));
