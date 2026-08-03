import { useEffect } from "react";
import { zoomKey } from "./zoom";
import { useZoomStore } from "./zoomStore";

/**
 * Ctrl+plus, Ctrl+minus and Ctrl+0.
 *
 * Handled rather than left alone: users try them, and if the app ignores them
 * the webview may act on its own, leaving the slider reporting a zoom that is
 * no longer the one on screen. Routing them through the same store keeps the
 * two describing one value.
 *
 * Unlike the transport shortcuts these are *not* suppressed while typing: zoom
 * is chrome, not content, and Ctrl+plus in a text field still means zoom.
 */
export function useZoomShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = zoomKey(event);
      if (action === null) {
        return;
      }
      event.preventDefault();

      const zoom = useZoomStore.getState();
      if (action === "in") {
        void zoom.step(1);
      } else if (action === "out") {
        void zoom.step(-1);
      } else {
        void zoom.reset();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
