import { DRAG_THRESHOLD_PX } from "../library/columnDrag";

/**
 * Dragging rows, without the webview's drag and drop.
 *
 * HTML5 drag and drop is unavailable to this app the moment `dragDropEnabled`
 * is turned on for OS file drops, and the two cannot coexist - so every drag
 * that stays inside the window is a pointer gesture, the way the column
 * reorder in `columnDrag.ts` already was.
 *
 * The session lives here as module state rather than in a store: the badge
 * moves every frame, and rows subscribe to nothing by design. Drop targets read
 * it synchronously in their own handlers.
 */

/** Where the badge sits relative to the pointer, down and to the right. */
const BADGE_OFFSET_PX = 14;

/** A press that has not travelled far enough to be a drag yet. */
interface Press {
  startX: number;
  startY: number;
  /**
   * Run once the press is recognised as a drag; returns what to carry.
   *
   * A callback rather than the ids themselves because the source row decides
   * the selection at that moment - a press is still only a click.
   */
  begin: () => number[];
}

/** A drag in progress. */
interface Session {
  ids: number[];
  badge: HTMLElement;
}

let press: Press | null = null;
let session: Session | null = null;
/**
 * Whether the `click` after this `pointerup` belongs to a drag.
 *
 * `pointerup` precedes `click`, so without this every reorder would also
 * re-select the row it started on - the same problem `ColumnHeader` solves for
 * the sort.
 */
let swallowClick = false;
const endListeners = new Set<() => void>();

/** Whether a track drag is in progress. */
export function isTrackDragging(): boolean {
  return session !== null;
}

/** What the drag in progress is carrying, or nothing if there is no drag. */
export function trackDragIds(): number[] {
  return session === null ? [] : [...session.ids];
}

/**
 * Called when a drag ends, however it ended.
 *
 * Drop targets hold their own indicator state and would otherwise be left
 * showing it after an Escape or a `pointercancel`, neither of which reaches
 * them as an event of their own.
 */
export function onTrackDragEnd(listener: () => void): () => void {
  endListeners.add(listener);
  return () => void endListeners.delete(listener);
}

/**
 * Begins watching a press on a row.
 *
 * The press is module state rather than the row's, because the threshold can
 * be crossed over a *different* row: pointer events without capture go to
 * whatever is under the pointer, and four pixels is enough to leave a 26px row
 * that was pressed near its edge.
 */
export function pressTrackRow(event: { clientX: number; clientY: number }, begin: () => number[]) {
  // The click this press will produce is an ordinary one until proven
  // otherwise, and the flag may be left over from a drag that ended on another
  // row - where no `click` fired to consume it.
  swallowClick = false;
  press = { startX: event.clientX, startY: event.clientY, begin };
  listen();
}

/**
 * Whether the `click` now being handled should be dropped on the floor.
 *
 * Consumes the flag: one click follows one drag.
 */
export function consumeTrackDragClick(): boolean {
  const swallow = swallowClick;
  swallowClick = false;
  return swallow;
}

/**
 * Whether a press that has travelled this far is a drag.
 *
 * On the distance rather than on x alone, which is all a column reorder needed:
 * a row drag is vertical for a reorder and horizontal for the sidebar.
 */
function isTrackDragGesture(startX: number, startY: number, x: number, y: number): boolean {
  return Math.hypot(x - startX, y - startY) >= DRAG_THRESHOLD_PX;
}

/**
 * Turns a pointer position inside a row into an insertion index.
 *
 * Dropping on the upper half of a row means "above this one", on the lower
 * half "below it" - the same convention every list with drag-reorder uses, and
 * the only way to express "after the last row".
 */
export function dropIndexFor(rowIndex: number, offsetY: number, rowHeight: number): number {
  return offsetY >= rowHeight / 2 ? rowIndex + 1 : rowIndex;
}

/**
 * The same answer as {@link dropIndexFor}, from a position in the whole list
 * rather than from a row that was under the pointer.
 *
 * The auto-scroll loop has no row to ask: a stationary pointer over a
 * scrolling virtualized list fires no `pointermove`, and the rows under it
 * change anyway.
 */
export function dropIndexAt(offsetY: number, rowHeight: number, rowCount: number): number {
  return Math.min(rowCount, Math.max(0, Math.round(offsetY / rowHeight)));
}

/** How fast a drag held against an edge scrolls, at the deepest point of the band. */
const MAX_EDGE_SCROLL_PX_PER_S = 800;

/**
 * How fast the list under the pointer should scroll, in pixels per second;
 * negative for up, zero outside the bands.
 *
 * Linear in how deep into the band the pointer is, so the edge of the band
 * creeps and the very edge of the list races. A pointer past the edge entirely
 * - dragging out of the window - counts as fully deep rather than as further
 * still.
 */
export function edgeScrollSpeed(
  clientY: number,
  top: number,
  bottom: number,
  band: number,
): number {
  const depthUp = top + band - clientY;
  if (depthUp > 0) {
    return -MAX_EDGE_SCROLL_PX_PER_S * Math.min(1, depthUp / band);
  }
  const depthDown = clientY - (bottom - band);
  if (depthDown > 0) {
    return MAX_EDGE_SCROLL_PX_PER_S * Math.min(1, depthDown / band);
  }
  return 0;
}

/**
 * The badge shown under the pointer while rows are being dragged.
 *
 * A `position: fixed` element moved by `transform`, imperatively: as React
 * state it would re-render a subscriber every frame. It carries a count
 * because what is being dragged is "seven songs", not a rectangle of the
 * screen - which is all the browser's own translucent row screenshot ever was.
 */
function createBadge(count: number, x: number, y: number): HTMLElement {
  const badge = document.createElement("div");
  badge.className = "drag-badge";
  badge.textContent = `${count} song${count === 1 ? "" : "s"}`;
  document.body.appendChild(badge);
  moveBadge(badge, x, y);
  return badge;
}

function moveBadge(badge: HTMLElement, x: number, y: number): void {
  badge.style.transform = `translate(${x + BADGE_OFFSET_PX}px, ${y + BADGE_OFFSET_PX}px)`;
}

/**
 * Recognises a press as a drag, or moves the badge of one already recognised.
 *
 * Bound on the window in the *capture* phase, so a row's own `pointermove`
 * handler sees `isTrackDragging()` as true on the very event that started the
 * drag rather than a frame later.
 */
function onPointerMove(event: PointerEvent): void {
  if (session !== null) {
    moveBadge(session.badge, event.clientX, event.clientY);
    return;
  }
  if (
    press === null ||
    !isTrackDragGesture(press.startX, press.startY, event.clientX, event.clientY)
  ) {
    return;
  }
  const ids = press.begin();
  press = null;
  if (ids.length === 0) {
    stop();
    return;
  }
  session = { ids, badge: createBadge(ids.length, event.clientX, event.clientY) };
}

/**
 * Ends the drag, after the drop.
 *
 * On the window in the bubble phase, which is after React's own listener on
 * the root - so a target has already performed the drop by the time this runs.
 * That is why no target may `stopPropagation`.
 */
function onPointerUp(): void {
  const dragged = session !== null;
  stop();
  swallowClick = dragged;
}

function onCancel(): void {
  const dragged = session !== null;
  stop();
  // A cancelled drag still ends in a `pointerup` and a `click` on the row it
  // started on, and that click is no more a selection than the drop would have
  // been.
  swallowClick = dragged;
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape" && session !== null) {
    onCancel();
  }
}

function listen(): void {
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKeyDown);
}

/** Tears everything down: the listeners, the badge, and the state. */
function stop(): void {
  window.removeEventListener("pointermove", onPointerMove, true);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onCancel);
  window.removeEventListener("keydown", onKeyDown);
  press = null;
  if (session !== null) {
    session.badge.remove();
    session = null;
    for (const listener of endListeners) {
      listener();
    }
  }
}
