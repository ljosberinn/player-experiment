/**
 * Telling a header click apart from a header drag.
 *
 * Clicking a header sorts, and that is all a header did before this phase.
 * Dragging one now reorders, so the two share a pointer press and have to be
 * separated by how far it travels rather than by a mode the user must enter.
 */

/**
 * How far the pointer must move before a press becomes a drag.
 *
 * Small enough that a deliberate drag is recognised immediately; large enough
 * that the shake in an ordinary click never is. A click that moved three
 * pixels is still a click.
 */
export const DRAG_THRESHOLD_PX = 4;

export function isDrag(startX: number, currentX: number): boolean {
  return Math.abs(currentX - startX) >= DRAG_THRESHOLD_PX;
}

/**
 * Where a column dragged to `x` should land, as an index into the order with
 * the dragged column removed.
 *
 * Measured against each header's midpoint: a column dropped on the left half
 * of another goes before it, on the right half after it. Using the leading
 * edge instead would mean a column never swaps with its neighbour until the
 * pointer has crossed the whole of it.
 */
export function columnDropIndex(
  bounds: readonly { left: number; right: number }[],
  draggedIndex: number,
  x: number,
): number {
  let index = 0;
  for (const [i, bound] of bounds.entries()) {
    // The dragged column is not in the order being counted into, so its own
    // width must not shift the answer.
    if (i === draggedIndex) {
      continue;
    }
    if (x > (bound.left + bound.right) / 2) {
      index += 1;
    }
  }
  return index;
}

/**
 * The width a divider drag has reached.
 *
 * Clamped by the caller's minimum: dragging left past it should stop, not
 * produce a negative width that renders as a column with no header to grab.
 */
export function draggedWidth(startWidth: number, startX: number, x: number, min: number): number {
  return Math.max(min, startWidth + (x - startX));
}

/**
 * The horizontal padding a header and a cell each carry, which a fitted width
 * has to make room for on top of the text itself.
 *
 * One number for both because `.song-header-cell` and `.song-cell` are both
 * `12px` a side. See `App.css`; a guard there keeps them in step.
 */
export const CELL_PADDING_PX = 24;

/**
 * The width that fits the widest of `contents`.
 *
 * **Visible rows only**, which is the whole compromise: the table is
 * virtualized and a library runs to six figures, so the widest value in a
 * column is neither in the DOM nor cheap to ask the database for. The
 * consequence is that fitting is not idempotent - scroll, fit again, and the
 * width changes. That is the accepted behaviour rather than a defect.
 *
 * Rounded up, because a width rounded down clips the character it measured.
 */
export function fittedWidth(contents: readonly number[], min: number): number {
  return Math.max(min, Math.ceil(Math.max(0, ...contents) + CELL_PADDING_PX));
}
