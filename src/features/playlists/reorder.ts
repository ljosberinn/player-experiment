/**
 * Where a keyboard nudge lands, as the insertion index `moveTracks` takes.
 *
 * Split from the table for the same reason `dropIndexFor` is: the arithmetic
 * below is the whole feature, and it is off by one in both directions if
 * anybody guesses at it.
 */

/** Which way a nudge goes. Up is towards index 0, the way the table reads. */
export type NudgeDirection = "up" | "down";

/**
 * The insertion index for nudging the rows at `indices` one place, or null
 * when there is no move to make.
 *
 * Down is `last + 2`, not `last + 1`. The index is expressed against the list
 * *including* the rows being moved, and the backend takes them out before
 * resolving it - so `last + 1` resolves back to where the block already sits
 * and the row appears not to move at all.
 *
 * A **scattered selection is refused** rather than moved. The backend collapses
 * a multi-selection into one block wherever it lands, which is right for a drag
 * - the drop indicator shows exactly where the block is going before the mouse
 * comes up. A nudge shows nothing beforehand, so the same rule would silently
 * gather rows from across the playlist into a pile, and reordering has no undo.
 */
export function nudgeTarget(
  indices: readonly number[],
  direction: NudgeDirection,
  total: number,
): number | null {
  if (indices.length === 0) {
    return null;
  }

  const sorted = [...indices].sort((left, right) => left - right);
  const first = sorted[0] as number;
  const last = sorted[sorted.length - 1] as number;
  if (last - first + 1 !== sorted.length) {
    return null;
  }

  if (direction === "up") {
    return first === 0 ? null : first - 1;
  }
  return last >= total - 1 ? null : last + 2;
}
