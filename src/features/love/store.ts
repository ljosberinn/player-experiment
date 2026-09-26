import type { UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import { lovedTracks, onLovedChanged, setLoved } from "../../ipc";
import { report } from "../shell/statusStore";

interface LovedState {
  /**
   * The library tracks the user loves.
   *
   * Held whole rather than asked per row: a right-click menu has to say Love
   * or Unlove the instant it opens, and `rowMenuItems` is pure and
   * synchronous.
   */
  loved: ReadonlySet<number>;
  /** Reads the set. Called at startup, and whenever the backend says it moved. */
  load: () => Promise<void>;
  /**
   * Loves or unloves `trackIds`, answering in the UI before the backend has.
   *
   * The set moves first and is replaced by what the backend answers with,
   * which is the whole set: two library rows can share one match key, and
   * loving either loves both.
   */
  love: (trackIds: number[], loved: boolean) => Promise<void>;
  /**
   * Re-reads the set whenever the backend moves it on its own: last.fm's loves
   * arriving, or an upgraded library's tracks being keyed. Called once, at
   * startup; resolves to its own teardown.
   */
  watch: () => Promise<UnlistenFn>;
}

/**
 * `ids` as a set, or `current` itself when it already holds exactly those.
 *
 * The backend answers with the whole set, and usually with the one the UI
 * already shows - the optimistic love it confirms, or a `loved://changed` that
 * moved nothing here. Every menu and the player bar read the set.
 */
function kept(current: ReadonlySet<number>, ids: number[]): ReadonlySet<number> {
  const next = new Set(ids);
  return next.size === current.size && [...next].every((id) => current.has(id)) ? current : next;
}

/**
 * The loved set.
 *
 * Its own store rather than a field on the last.fm one: loving works on every
 * build and with no account, and last.fm is only a mirror of it.
 */
export const useLovedStore = create<LovedState>((set, get) => ({
  loved: new Set<number>(),

  load: async () => {
    try {
      const loved = await lovedTracks();
      set((state) => ({ loved: kept(state.loved, loved) }));
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
      const answer = await setLoved(trackIds, loved);
      set((state) => ({ loved: kept(state.loved, answer) }));
    } catch (error) {
      // A local write refused whole - a row that lost its artist or title
      // since the menu opened - so the set is as it was.
      report(error);
      set({ loved: before });
    }
  },

  watch: () => onLovedChanged(() => void get().load()),
}));
