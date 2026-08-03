import { useEffect } from "react";
import {
  type GlobalShortcutPorts,
  type MediaKeyAction,
  registerMediaKeys,
  unregisterMediaKeys,
} from "./globalKeys";
import { usePlayerStore } from "./store";

/**
 * The real plugin, imported lazily.
 *
 * Dynamic so the plugin's bundle is not part of the first paint - nothing here
 * is needed to render the library - and so the tests can supply their own
 * ports without the module being pulled into jsdom.
 */
export const tauriGlobalShortcuts: GlobalShortcutPorts = {
  register: async (accelerator, handler) => {
    const { register } = await import("@tauri-apps/plugin-global-shortcut");
    await register(accelerator, (event) => {
      // The plugin fires on press *and* release; acting on both would toggle
      // playback twice per tap and leave it exactly where it started.
      if (event.state === "Pressed") {
        handler();
      }
    });
  },
  unregister: async (accelerator) => {
    const { unregister } = await import("@tauri-apps/plugin-global-shortcut");
    await unregister(accelerator);
  },
};

/**
 * Claims the media keys from the OS for as long as the app is running.
 *
 * Reads the store imperatively for the same reason `usePlayerShortcuts` does:
 * a key needs the state at the moment it fires, and subscribing would
 * re-register the shortcuts on every position tick.
 */
export function useGlobalMediaKeys(ports: GlobalShortcutPorts = tauriGlobalShortcuts): void {
  useEffect(() => {
    let claimed: string[] = [];
    let cancelled = false;

    const run = (action: MediaKeyAction) => {
      const state = usePlayerStore.getState();
      switch (action) {
        case "toggle":
          void state.toggle();
          return;
        case "next":
          void state.next();
          return;
        case "previous":
          void state.previous();
          return;
        case "stop":
          void state.stop();
      }
    };

    void registerMediaKeys(ports, run).then((accelerators) => {
      claimed = accelerators;
      // Unmounted while registering: release immediately rather than leaving
      // the OS routing media keys at a window that has gone.
      if (cancelled) {
        void unregisterMediaKeys(ports, claimed);
      }
    });

    return () => {
      cancelled = true;
      void unregisterMediaKeys(ports, claimed);
    };
  }, [ports]);
}
