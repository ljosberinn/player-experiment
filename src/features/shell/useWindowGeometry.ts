import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { availableMonitors, getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { loadWindowGeometry, saveWindowGeometry } from "../../ipc";
import { debounce } from "../../lib/debounce";
import { isOnScreen, parse, serialize } from "./geometry";
import { useZoomStore } from "./zoomStore";

/**
 * How long a drag or resize has to settle before it is written.
 *
 * Moving a window emits a position event per frame; without this the setting
 * would be written a hundred times per drag.
 */
export const GEOMETRY_DEBOUNCE_MS = 400;

/**
 * Restores the window's last position on mount, and remembers it thereafter.
 *
 * Restoring is best-effort by design: any failure leaves the window wherever
 * the OS put it, which is a perfectly good outcome, so nothing here surfaces
 * an error to the user.
 */
export function useWindowGeometry(): void {
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const save = debounce(() => {
      void (async () => {
        try {
          // A maximized window's position and size are the maximized ones,
          // which would be restored as a manually-sized window filling the
          // screen. Only the flag is worth keeping in that state.
          const maximized = await appWindow.isMaximized();
          if (maximized) {
            const stored = parse(await loadWindowGeometry());
            if (stored !== null) {
              await saveWindowGeometry(serialize({ ...stored, maximized: true }));
            }
            return;
          }
          const position = await appWindow.outerPosition();
          const size = await appWindow.outerSize();
          await saveWindowGeometry(
            serialize({
              x: position.x,
              y: position.y,
              width: size.width,
              height: size.height,
              maximized: false,
            }),
          );
        } catch {
          // Losing a window position is not worth interrupting anyone over.
        }
      })();
    }, GEOMETRY_DEBOUNCE_MS);

    void (async () => {
      await restore(appWindow, () => cancelled);

      if (cancelled) {
        return;
      }
      const offMoved = await appWindow.onMoved(() => save());
      const offResized = await appWindow.onResized(() => save());
      unlisten = () => {
        offMoved();
        offResized();
      };
      if (cancelled) {
        unlisten();
      }
    })();

    return () => {
      cancelled = true;
      // Whatever the last move was, write it now rather than losing it.
      save.flush();
      unlisten?.();
    };
  }, []);
}

/**
 * Everything that has to happen before the window is on screen, in order.
 *
 * Each step swallows its own failure: none of them is worth interrupting
 * anyone over, and none of them may stop the one that comes after.
 */
async function restore(appWindow: Window, cancelled: () => boolean): Promise<void> {
  try {
    const stored = parse(await loadWindowGeometry());
    if (stored !== null && !cancelled()) {
      const screens = await availableScreens();
      // A position on a monitor that is no longer attached would put the
      // window somewhere the user cannot reach it.
      if (screens.length === 0 || isOnScreen(stored, screens)) {
        await appWindow.setPosition(new PhysicalPosition(stored.x, stored.y));
        await appWindow.setSize(new PhysicalSize(stored.width, stored.height));
      }
      if (stored.maximized) {
        await appWindow.maximize();
      }
    }
  } catch {
    // Leave the window where the OS put it.
  }

  // Zoom is applied here rather than in its own effect because it has to
  // happen before the window is shown: applying it afterwards means the user
  // watches the whole app resize itself on every launch. The window is already
  // hidden for the geometry restore, so this costs nothing.
  try {
    await useZoomStore.getState().load();
  } catch {
    // A failed zoom restore must not stop the window appearing.
  }

  // The window starts hidden (`"visible": false` in tauri.conf.json) so the
  // user never sees it appear at the default size and position and then jump
  // to the stored one. Showing it is therefore not optional: this runs even
  // when the restore above threw, or there was nothing stored, or the effect
  // was cancelled - a window that never shows is a far worse failure than one
  // in the wrong place.
  try {
    await appWindow.show();
  } catch {
    // Nothing left to do about it, and nothing worth saying to the user.
  }
}

/** The monitors Tauri knows about, or none if it will not say. */
async function availableScreens() {
  try {
    // Statically imported: this module is already in the entry chunk via
    // `getCurrentWindow` above, so a dynamic import here bought no splitting
    // and only made Vite warn about the mixed usage.
    const monitors = await availableMonitors();
    return monitors.map((monitor) => ({
      x: monitor.position.x,
      y: monitor.position.y,
      width: monitor.size.width,
      height: monitor.size.height,
    }));
  } catch {
    // Unknown is not the same as none: with no monitor list the safe move is
    // to trust the stored position rather than to overrule it.
    return [];
  }
}
