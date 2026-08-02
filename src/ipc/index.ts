import { invoke } from "@tauri-apps/api/core";
import type { AppInfo } from "./bindings/AppInfo";

export type { AppInfo };

/**
 * Typed wrappers around `invoke`. Components never call `invoke` directly, so
 * the whole IPC surface is one mockable module in tests.
 */
export function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("get_app_info");
}
