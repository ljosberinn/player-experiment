import { create } from "zustand";
import { loadUnattendedLookup, saveUnattendedLookup } from "../../ipc";

/**
 * Whether the app may look releases up on MusicBrainz on its own.
 *
 * Off by default, which is the opposite of every other preference: it is the
 * one switch that makes the app talk to a server and write tags with nobody
 * watching, so its absence has to read as "not asked for" rather than as a
 * setting somebody cleared.
 *
 * Nothing on screen depends on it - the backend reads the setting itself,
 * between releases - so it is loaded when Settings opens rather than at
 * startup, and only that dialog subscribes.
 */
interface LookupState {
  enabled: boolean;
  /** Reads the stored preference. Called when Settings opens. */
  load: () => Promise<void>;
  set: (enabled: boolean) => Promise<void>;
}

export const useLookupStore = create<LookupState>((set, get) => ({
  enabled: false,

  load: async () => {
    try {
      set({ enabled: await loadUnattendedLookup() });
    } catch {
      // Off is the safe answer to an unreadable setting: it is what stops the
      // app doing something nobody asked for.
    }
  },

  set: async (enabled) => {
    if (enabled === get().enabled) {
      return;
    }
    // Flipped locally first, so the checkbox answers the click rather than the
    // round trip.
    set({ enabled });
    try {
      await saveUnattendedLookup(enabled);
    } catch {
      // Left showing what was asked for; the next change tries again.
    }
  },
}));
