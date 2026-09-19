import { useEffect, useRef } from "react";
import { registerDropTarget } from "../shell/fileDrop";
import { useScanStore } from "./scan";

/** The class the pane wears while a file drag is over it. */
export const HOVER_CLASS = "drop-target";

/**
 * Makes the library pane take OS drops, for as long as the window is open.
 *
 * Returns the ref to hang on the element. **Holds no React state**: `over`
 * fires on every pointer move, and the outline is a class toggled on the
 * element rather than a render of the app - which is what this being mounted in
 * `App` would otherwise cost, on the view with 150k rows in it.
 *
 * The pane and not the song table: the table is not rendered in the empty
 * state, which is exactly where a first drop lands, nor on the views that
 * browse rather than list.
 */
export function useLibraryDrop(): React.RefObject<HTMLElement | null> {
  const pane = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = pane.current;
    if (element === null) {
      return;
    }
    return registerDropTarget({
      element,
      onHover: (over) => element.classList.toggle(HOVER_CLASS, over),
      // Read off the store rather than subscribed to: the action is stable,
      // and a drop is the only thing that needs it.
      onDrop: (paths) => void useScanStore.getState().drop(paths),
    });
  }, []);
  return pane;
}
