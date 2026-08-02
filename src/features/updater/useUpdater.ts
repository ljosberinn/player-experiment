import { useEffect } from "react";
import { type UpdaterPorts, useUpdaterStore } from "./store";

/** How often to look, after the check made at launch. */
export const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * The real Tauri updater, behind the store's port interface.
 *
 * Imported lazily inside the calls so the plugin is only touched when a check
 * actually runs - in a test or a plain browser there is no Tauri to talk to,
 * and reaching for it at module load would break the import graph.
 */
export const tauriUpdater: UpdaterPorts = {
  check: async () => {
    const { check } = await import("@tauri-apps/plugin-updater");
    return await check();
  },
  relaunch: async () => {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  },
};

/**
 * Checks for an update at launch and then on a timer.
 *
 * Quietly: nothing appears unless there is something ready to install. A
 * failed check is a no-op - being offline is the normal case, not a fault.
 */
export function useUpdater(ports: UpdaterPorts = tauriUpdater): void {
  const check = useUpdaterStore((s) => s.check);

  useEffect(() => {
    void check(ports);
    const timer = setInterval(() => void check(ports), UPDATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [check, ports]);
}
