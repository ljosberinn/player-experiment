import { create } from "zustand";
import { loadPaletteRecents, savePaletteRecents } from "../../ipc";
import { parseRecents, remember } from "./paletteRecents";

interface PaletteRecentsState {
  /** Entry keys, newest first. */
  recent: string[];
  loaded: boolean;
  load: () => Promise<void>;
  remember: (key: string) => void;
}

export const usePaletteRecentsStore = create<PaletteRecentsState>((set, get) => ({
  recent: [],
  loaded: false,

  load: async () => {
    if (get().loaded) {
      return;
    }
    let stored: string | null = null;
    try {
      stored = await loadPaletteRecents();
    } catch {
      // Recent starts empty, which is a first run's palette and a working one.
    }
    // A command run while the read was out has written over what it read.
    if (!get().loaded) {
      set({ recent: parseRecents(stored), loaded: true });
    }
  },

  remember: (key) => {
    const recent = remember(get().recent, key);
    set({ recent, loaded: true });
    void savePaletteRecents(JSON.stringify(recent)).catch(() => {});
  },
}));
