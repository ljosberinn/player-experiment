import { create } from "zustand";
import { loadZoom, saveZoom } from "../../ipc";
import { clampZoom, DEFAULT_ZOOM, parseZoom, steppedZoom } from "./zoom";

/** What the app needs from the webview to change its zoom. */
export interface ZoomPorts {
  setZoom: (factor: number) => Promise<void>;
}

/**
 * The real webview, imported lazily so the API is not pulled into the first
 * paint and the tests can supply their own port.
 */
export const webviewZoom: ZoomPorts = {
  setZoom: async (factor) => {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setZoom(factor);
  },
};

interface ZoomState {
  factor: number;
  /** Reads the stored zoom and applies it. Called before the window is shown. */
  load: (ports?: ZoomPorts) => Promise<void>;
  /** Sets an absolute factor, from the slider. */
  set: (factor: number, ports?: ZoomPorts) => Promise<void>;
  /** Steps in or out, from Ctrl+plus / Ctrl+minus. */
  step: (direction: number, ports?: ZoomPorts) => Promise<void>;
  reset: (ports?: ZoomPorts) => Promise<void>;
}

export const useZoomStore = create<ZoomState>((set, get) => ({
  factor: DEFAULT_ZOOM,

  load: async (ports = webviewZoom) => {
    let factor = DEFAULT_ZOOM;
    try {
      factor = parseZoom(await loadZoom());
    } catch {
      // An unreadable setting is not worth blocking startup; 1.0 is a working
      // app, and phase 21a made it the right default rather than a fallback.
    }
    set({ factor });
    try {
      await ports.setZoom(factor);
    } catch {
      // Nothing to do: the app renders at 1.0, which is legible.
    }
  },

  set: async (factor, ports = webviewZoom) => {
    const next = clampZoom(factor);
    if (next === get().factor) {
      return;
    }
    set({ factor: next });
    try {
      await ports.setZoom(next);
      // Persisted after applying, so a rejected zoom is not remembered as if
      // it had worked.
      await saveZoom(String(next));
    } catch {
      // Leave the store showing what was asked for rather than snapping the
      // slider back mid-drag; the next change will try again.
    }
  },

  step: async (direction, ports = webviewZoom) => {
    await get().set(steppedZoom(get().factor, direction), ports);
  },

  reset: async (ports = webviewZoom) => {
    await get().set(DEFAULT_ZOOM, ports);
  },
}));
