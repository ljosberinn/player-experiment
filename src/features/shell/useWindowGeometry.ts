import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { loadWindowGeometry, saveWindowGeometry } from "../../ipc";
import { debounce } from "../../lib/debounce";
import { isOnScreen, parse, serialize } from "./geometry";

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
      try {
        const stored = parse(await loadWindowGeometry());
        if (stored !== null && !cancelled) {
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

/** The monitors Tauri knows about, or none if it will not say. */
async function availableScreens() {
  try {
    const { availableMonitors } = await import("@tauri-apps/api/window");
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
