import { useEffect, useState } from "react";
import { usePlayerStore } from "./store";

/** How long a pause lasts before the bar gets out of the way. */
export const IDLE_HIDE_MS = 5 * 60_000;

/**
 * Whether the player has sat paused long enough to hide the bar.
 *
 * A store subscription rather than a selector: the clock restarts on every
 * play and pause, and a selector on `status` would re-render the bar for each
 * one when only the flip to hidden and back matters.
 *
 * A seek while paused restarts it too. The arrow keys and Previous both move a
 * paused song without changing its status, and a key that moves the hidden
 * bar's song has to bring the bar back or it acts with nothing on screen.
 */
export function useIdleHidden(): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const restart = (paused: boolean) => {
      clearTimeout(timer);
      setHidden(false);
      if (paused) {
        timer = setTimeout(() => setHidden(true), IDLE_HIDE_MS);
      }
    };

    restart(usePlayerStore.getState().status === "paused");
    const unsubscribe = usePlayerStore.subscribe((state, previous) => {
      const paused = state.status === "paused";
      if (
        state.status !== previous.status ||
        (paused && state.positionMs !== previous.positionMs)
      ) {
        restart(paused);
      }
    });

    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  return hidden;
}
