import type { DragDropEvent } from "@tauri-apps/api/webview";
import { useEffect } from "react";
import { onFileDrop } from "../../ipc";

/**
 * Files dragged in from the OS, routed to whatever part of the window is under
 * the pointer.
 *
 * With `dragDropEnabled` on, the page sees no `dragover` or `drop` at all: the
 * webview's drop target is revoked and the paths arrive as one window-wide
 * event carrying a position. Deciding which element that position is over is
 * therefore the app's job, done here against targets that register themselves
 * while mounted.
 */

/** A part of the window that takes OS file drops. */
export interface DropTarget {
  element: HTMLElement;
  /**
   * Called when a file drag comes over the target and when it leaves, never in
   * between. The cursor says "copy" over the whole window whatever is under it,
   * so this is the only way the target can say it is the one.
   */
  onHover: (over: boolean) => void;
  onDrop: (paths: string[]) => void;
}

/**
 * The registered targets, oldest first, and whichever one a drag is currently
 * over.
 *
 * A stack rather than one slot because two things take drops and one sits on
 * top of the other: the library pane is registered for as long as the window
 * is open, and the tag editor's artwork block joins it while the dialog is. Hit
 * testing runs from the top down, so the dialog wins where they overlap.
 */
const targets: DropTarget[] = [];
let hovered: DropTarget | null = null;

/** Puts `next` on top of the stack; returns what takes it off again. */
export function registerDropTarget(next: DropTarget): () => void {
  targets.push(next);
  return () => {
    const at = targets.indexOf(next);
    if (at !== -1) {
      targets.splice(at, 1);
    }
    // No `onHover(false)`: the target is going away, and the only thing that
    // call could reach is an unmounted component.
    if (hovered === next) {
      hovered = null;
    }
  };
}

/**
 * Whether a point in physical pixels lies over `element`.
 *
 * The event speaks physical pixels and the layout speaks CSS pixels. Webview
 * zoom is folded into `devicePixelRatio` along with the display's scale, so the
 * one division holds at any DPI and any zoom.
 */
export function isOver(
  element: HTMLElement,
  position: { x: number; y: number },
  pixelRatio: number,
): boolean {
  const x = position.x / pixelRatio;
  const y = position.y / pixelRatio;
  const box = element.getBoundingClientRect();
  return x >= box.left && x < box.right && y >= box.top && y < box.bottom;
}

/** The topmost registered target under `position`, if any. */
function hit(position: { x: number; y: number }, pixelRatio: number): DropTarget | null {
  for (let index = targets.length - 1; index >= 0; index -= 1) {
    const candidate = targets[index];
    if (candidate !== undefined && isOver(candidate.element, position, pixelRatio)) {
      return candidate;
    }
  }
  return null;
}

function hover(next: DropTarget | null): void {
  // The position arrives continuously while a drag sits over the window; a
  // target hears only the changes.
  if (next === hovered) {
    return;
  }
  hovered?.onHover(false);
  hovered = next;
  next?.onHover(true);
}

/** Delivers one drag-drop event to the topmost target it hits. */
export function routeFileDrop(event: DragDropEvent, pixelRatio: number): void {
  if (event.type === "leave") {
    hover(null);
    return;
  }
  const over = hit(event.position, pixelRatio);
  if (event.type === "drop") {
    hover(null);
    over?.onDrop(event.paths);
    return;
  }
  hover(over);
}

/**
 * Subscribes the window to OS file drops for as long as it is mounted.
 *
 * Holds no React state: `over` fires on every pointer move, and whatever
 * reacts to a hover does so in the target's own component.
 */
export function useFileDrops(): void {
  useEffect(() => {
    // The subscription resolves asynchronously and may land after unmount.
    let off: (() => void) | null = null;
    let cancelled = false;
    void onFileDrop((event) => routeFileDrop(event, window.devicePixelRatio)).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        off = unlisten;
      }
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);
}
