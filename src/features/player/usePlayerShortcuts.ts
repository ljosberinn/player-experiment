import { useEffect } from "react";
import { SEEK_STEP_MS, shortcutFor, targetOwns, VOLUME_STEP } from "./shortcuts";
import { usePlayerStore } from "./store";

/**
 * Binds the transport to the keyboard, window-wide.
 *
 * Reads the store imperatively rather than subscribing: a shortcut needs the
 * value at the moment it fires, and subscribing would rebind the listener on
 * every position tick.
 */
export function usePlayerShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = shortcutFor(event);
      if (!shortcut || targetOwns(event.target, shortcut)) {
        return;
      }

      const state = usePlayerStore.getState();
      // Only once we know the key is ours - otherwise this would swallow
      // scrolling and typing everywhere in the app.
      event.preventDefault();

      switch (shortcut) {
        case "toggle":
          void state.toggle();
          return;
        case "next":
          void state.next();
          return;
        case "previous":
          void state.previous();
          return;
        case "seekForward":
          void state.seek(state.positionMs + SEEK_STEP_MS);
          return;
        case "seekBackward":
          void state.seek(state.positionMs - SEEK_STEP_MS);
          return;
        case "volumeUp":
          void state.setVolume(state.volume + VOLUME_STEP);
          return;
        case "volumeDown":
          void state.setVolume(state.volume - VOLUME_STEP);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
