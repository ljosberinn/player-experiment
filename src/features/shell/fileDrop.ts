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

/** One slot, because there is one target: the tag editor's artwork block. */
let target: DropTarget | null = null;
let hovering = false;

/** Makes `next` the drop target; returns what takes it off again. */
export function registerDropTarget(next: DropTarget): () => void {
  target = next;
  hovering = false;
  return () => {
    if (target === next) {
      target = null;
      hovering = false;
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

function hover(current: DropTarget, over: boolean): void {
  // `over` arrives continuously while a drag sits over the window; a target
  // hears only the changes.
  if (over !== hovering) {
    hovering = over;
    current.onHover(over);
  }
}

/** Delivers one drag-drop event to the registered target, if it is hit. */
export function routeFileDrop(event: DragDropEvent, pixelRatio: number): void {
  const current = target;
  if (current === null) {
    return;
  }
  if (event.type === "leave") {
    hover(current, false);
    return;
  }
  const over = isOver(current.element, event.position, pixelRatio);
  if (event.type === "drop") {
    hover(current, false);
    if (over) {
      current.onDrop(event.paths);
    }
    return;
  }
  hover(current, over);
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
