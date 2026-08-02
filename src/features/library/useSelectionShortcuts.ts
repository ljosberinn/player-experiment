import { useEffect } from "react";
import { isTypingTarget } from "../player/shortcuts";
import { useLibraryStore } from "./store";

/**
 * Window-level selection keys.
 *
 * Separate from the player shortcuts because those deliberately ignore any key
 * pressed with a modifier - Ctrl+A is a modifier chord, so it could never have
 * reached them. `selectAll` existed in the store from the start and had no way
 * to be triggered until this.
 */
export function useSelectionShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl+A in the search box means "select this text", which is a much
      // more useful thing for it to do while you are typing in one.
      if (isTypingTarget(event.target)) {
        return;
      }

      const selectAll = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a";
      if (selectAll) {
        event.preventDefault();
        // Every id the query matches, not just the loaded pages: a selection
        // truncated at whatever happened to be scrolled into view would be a
        // trap for the bulk operations that follow it.
        void useLibraryStore.getState().selectAll();
        return;
      }

      if (event.key === "Escape" && useLibraryStore.getState().selection.ids.size > 0) {
        event.preventDefault();
        useLibraryStore.getState().clearSelection();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
