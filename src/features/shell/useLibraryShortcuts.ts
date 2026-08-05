import { useEffect } from "react";
import { useScanStore } from "../library/scan";
import { isTypingTarget } from "../player/shortcuts";

/**
 * Which library action a keydown maps to, if any.
 *
 * Split from the hook the way `shortcutFor` is, and for the same reason: the
 * mapping - including what it deliberately ignores - is testable without a DOM.
 *
 * F5 only, so far. It is the key Windows has meant "refresh this" since File
 * Manager, and rescanning is exactly that. It takes no modifiers: Ctrl+F5 and
 * Shift+F5 mean "harder refresh" in a browser and nothing here, so they are
 * left alone rather than quietly treated as the same thing.
 */
export function libraryShortcutFor(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): "rescan" | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    return null;
  }
  return event.key === "F5" ? "rescan" : null;
}

/**
 * Binds the library actions that have a key, window-wide.
 *
 * Separate from `usePlayerShortcuts` because the two answer to different
 * things: that one is the transport, this one is the library. They share
 * `isTypingTarget`, which is the rule that matters to both - a function key
 * pressed inside the search box is still the search box's.
 */
export function useLibraryShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || libraryShortcutFor(event) === null) {
        return;
      }
      // Only once the key is known to be ours. F5 would otherwise be swallowed
      // everywhere, including from a field that wanted it.
      event.preventDefault();
      // The store refuses a second scan while one is running, so holding the
      // key down cannot queue a hundred of them.
      void useScanStore.getState().rescan();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
