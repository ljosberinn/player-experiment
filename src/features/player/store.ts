import { create } from "zustand";
import {
  onPlayerError,
  onPlayerPosition,
  onPlayerState,
  type PlaybackStatus,
  playerNext,
  playerPlay,
  playerPrevious,
  playerSeek,
  playerSetMuted,
  playerSetRepeatOne,
  playerSetVolume,
  playerSnapshot,
  playerStop,
  playerToggle,
  type Track,
} from "../../ipc";

/**
 * Mirror of the Rust player.
 *
 * Every action is fire-and-forget: the backend owns playback state and reports
 * it back on `player://state`, so nothing here optimistically flips a button
 * and then has to reconcile. The one exception is volume, which is echoed
 * locally so the slider does not lag the drag.
 */
interface PlayerState {
  status: PlaybackStatus;
  track: Track | null;
  positionMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  repeatOne: boolean;
  queueIndex: number | null;
  queueLen: number;
  error: string | null;

  /** Subscribes to backend events and loads the current state. Returns an unsubscribe. */
  connect: () => Promise<() => void>;
  play: (trackIds: number[], index: number) => Promise<void>;
  toggle: () => Promise<void>;
  stop: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleRepeatOne: () => Promise<void>;
  dismissError: () => void;
}

const initial = {
  status: "stopped" as PlaybackStatus,
  track: null,
  positionMs: 0,
  durationMs: 0,
  volume: 0.8,
  muted: false,
  repeatOne: false,
  queueIndex: null,
  queueLen: 0,
  error: null,
};

/** Wraps a command so a dead backend surfaces in the UI instead of the console. */
async function run(
  set: (partial: Partial<PlayerState>) => void,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (cause) {
    set({ error: String(cause) });
  }
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  ...initial,

  connect: async () => {
    const unlisten = await Promise.all([
      onPlayerState((snapshot) =>
        set({
          status: snapshot.status,
          track: snapshot.track,
          durationMs: snapshot.durationMs,
          volume: snapshot.volume,
          muted: snapshot.muted,
          repeatOne: snapshot.repeatOne,
          queueIndex: snapshot.queueIndex,
          queueLen: snapshot.queueLen,
          // A state change is a load, a seek or a stop; in all three the
          // authoritative position comes with it.
          positionMs: snapshot.positionMs,
        }),
      ),
      onPlayerPosition(({ positionMs, durationMs }) => set({ positionMs, durationMs })),
      onPlayerError((error) => set({ error })),
    ]);

    // Listeners first, then the snapshot: a state change between the two would
    // otherwise be missed rather than merely applied twice.
    try {
      const snapshot = await playerSnapshot();
      set({
        status: snapshot.status,
        track: snapshot.track,
        positionMs: snapshot.positionMs,
        durationMs: snapshot.durationMs,
        volume: snapshot.volume,
        muted: snapshot.muted,
        repeatOne: snapshot.repeatOne,
        queueIndex: snapshot.queueIndex,
        queueLen: snapshot.queueLen,
      });
    } catch (cause) {
      set({ error: String(cause) });
    }

    return () => {
      for (const off of unlisten) {
        off();
      }
    };
  },

  play: (trackIds, index) => run(set, () => playerPlay(trackIds, index)),
  toggle: () => run(set, playerToggle),
  stop: () => run(set, playerStop),
  next: () => run(set, playerNext),
  previous: () => run(set, playerPrevious),

  seek: async (positionMs) => {
    // Echoed immediately so the scrubber follows the pointer; the backend
    // confirms with a position event a beat later.
    set({ positionMs: Math.max(0, Math.min(positionMs, get().durationMs)) });
    await run(set, () => playerSeek(positionMs));
  },

  setVolume: async (volume) => {
    const clamped = Math.max(0, Math.min(1, volume));
    // Muted goes with it: the backend lifts a mute when the rail moves, and
    // the rail is the one control echoed locally, so the echo has to say the
    // same thing or the fill would follow the pointer under a lit mute button
    // until the next state event caught up.
    set({ volume: clamped, muted: false });
    await run(set, () => playerSetVolume(clamped));
  },

  // No echo, unlike volume: these are one click rather than a drag, so the
  // state event they cause is the only thing that has to arrive.
  toggleMute: () => run(set, () => playerSetMuted(!get().muted)),
  toggleRepeatOne: () => run(set, () => playerSetRepeatOne(!get().repeatOne)),

  dismissError: () => set({ error: null }),
}));
