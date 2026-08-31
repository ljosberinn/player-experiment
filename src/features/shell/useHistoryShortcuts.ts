import { useEffect } from "react";
import { useLibraryStore } from "../library/store";
import { isTypingTarget } from "../player/shortcuts";

export type HistoryDirection = "back" | "forward";

/**
 * Which direction a keydown means, if any.
 *
 * Split from the hook the way `libraryShortcutFor` is, and for the same
 * reason: the mapping - including what it deliberately ignores - is testable
 * without a DOM.
 *
 * Alt and nothing else. Ctrl+← is word-wise cursor movement and Shift+← is a
 * selection; both mean something already, and neither means this.
 */
export function historyShortcutFor(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): HistoryDirection | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return null;
  }
  if (event.key === "ArrowLeft") {
    return "back";
  }
  return event.key === "ArrowRight" ? "forward" : null;
}

/**
 * Which direction a pointer button means, if any.
 *
 * 3 and 4 are the two side buttons, which every browser and file manager on
 * Windows already treats as back and forward. Everything else - including 1,
 * the middle button - is left alone.
 */
export function historyButtonFor(event: { button: number }): HistoryDirection | null {
  if (event.button === 3) {
    return "back";
  }
  return event.button === 4 ? "forward" : null;
}

/**
 * Binds the two ways back and forward are asked for.
 *
 * Beside `useLibraryShortcuts` rather than in it because one of the two is not
 * a key at all, and the pointer half answers to a different rule: the side
 * buttons work from inside the search box, where Alt+← does not. A thumb on a
 * mouse button is unambiguous while a hand on the keyboard is not - Alt+← in a
 * text field is close enough to the editing keys around it to be worth
 * leaving to the field.
 *
 * `pointerdown` rather than `auxclick`: Windows delivers the side buttons
 * through both, and by the time the click arrives the browser has already
 * decided nothing happened.
 */
export function useHistoryShortcuts(): void {
  useEffect(() => {
    const navigate = (direction: HistoryDirection) => {
      const store = useLibraryStore.getState();
      void (direction === "back" ? store.back() : store.forward());
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }
      const direction = historyShortcutFor(event);
      if (direction === null) {
        return;
      }
      // Only once the chord is known to be ours, so Alt+← reaches anything
      // else that wants it.
      event.preventDefault();
      navigate(direction);
    };

    const onPointerDown = (event: PointerEvent) => {
      const direction = historyButtonFor(event);
      if (direction === null) {
        return;
      }
      event.preventDefault();
      navigate(direction);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);
}
