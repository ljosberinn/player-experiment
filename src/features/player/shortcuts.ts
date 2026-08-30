import type { PlayerShortcut } from "./types";

/** How far the arrow keys move the playhead. */
export const SEEK_STEP_MS = 5_000;
/** How much the arrow keys, and the wheel over the rail, move the volume. */
export const VOLUME_STEP = 0.05;

/**
 * Which shortcut, if any, a keydown maps to.
 *
 * Split from the hook that binds it so the mapping - including everything it
 * deliberately ignores - is testable without a DOM.
 */
export function shortcutFor(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): PlayerShortcut | null {
  // Modifiers are left to the OS and to future menu accelerators; every
  // shortcut here is a bare key.
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }

  switch (event.key) {
    case " ":
      return "toggle";
    case "MediaPlayPause":
      return "toggle";
    case "MediaTrackNext":
      return "next";
    case "MediaTrackPrevious":
      return "previous";
    case "ArrowRight":
      return "seekForward";
    case "ArrowLeft":
      return "seekBackward";
    case "ArrowUp":
      return "volumeUp";
    case "ArrowDown":
      return "volumeDown";
    default:
      return null;
  }
}

/**
 * Whether a keydown on `target` belongs to the element rather than to the app.
 *
 * Space in the search box has to type a space, and the song table's own arrow
 * handling should win over seeking.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Whether the element under the keypress handles `shortcut` itself.
 *
 * A slider thumb focuses a visually hidden `<input type="range">`, so the
 * scrubber and the volume rail read as text fields to `isTypingTarget`. They
 * do own the arrows - they move on them, and a bare arrow reaching the player
 * as well would drag the rail and seek at once - but Space does nothing to a
 * slider, and play/pause has to keep working after a drag leaves one focused.
 */
export function targetOwns(target: EventTarget | null, shortcut: PlayerShortcut): boolean {
  if (target instanceof HTMLInputElement && target.type === "range") {
    return shortcut !== "toggle";
  }
  return isTypingTarget(target);
}
