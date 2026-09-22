/**
 * Table selection.
 *
 * Selection is a set of track ids plus an anchor, never an array of rows: the
 * table must be able to select 50k tracks without materialising 50k objects,
 * and ids survive rows being evicted from the page cache.
 */
export interface Selection {
  readonly ids: ReadonlySet<number>;
  /** Row index a shift-click ranges from; null when there is nothing to extend. */
  readonly anchorIndex: number | null;
}

export const emptySelection: Selection = { ids: new Set(), anchorIndex: null };

export type ClickModifiers = {
  shift?: boolean;
  /** Ctrl on Windows/Linux, Cmd on macOS. */
  meta?: boolean;
};

/**
 * Applies a click at `rowIndex` (whose track is `id`) to the current selection.
 *
 * `idsInRange` resolves a row-index range to ids, because a shift-range can
 * span rows the cache has evicted and only the caller can fetch those.
 */
export function applyClick(
  selection: Selection,
  rowIndex: number,
  id: number,
  modifiers: ClickModifiers,
  idsInRange: (from: number, to: number) => number[],
): Selection {
  if (modifiers.shift && selection.anchorIndex !== null) {
    const from = Math.min(selection.anchorIndex, rowIndex);
    const to = Math.max(selection.anchorIndex, rowIndex);
    const ranged = idsInRange(from, to);
    // A plain shift-click replaces the selection; ctrl+shift adds to it, which
    // is what lets you build up several ranges.
    const base = modifiers.meta ? selection.ids : new Set<number>();
    return { ids: new Set([...base, ...ranged]), anchorIndex: selection.anchorIndex };
  }

  if (modifiers.meta) {
    const ids = new Set(selection.ids);
    if (ids.has(id)) {
      ids.delete(id);
    } else {
      ids.add(id);
    }
    return { ids, anchorIndex: rowIndex };
  }

  return { ids: new Set([id]), anchorIndex: rowIndex };
}

/**
 * The row an arrow key moves the selection to, or null when there is none.
 *
 * Clamped rather than wrapping, and clamped rather than refused: at the last
 * row a `null` would leave the keypress to the scroll container, so holding
 * the key would move the selection down the list and then start scrolling
 * past it. The anchor doubles as the cursor, which is why this takes one and
 * answers one - a range extension needs a lead index of its own, and that is
 * a decision for whoever asks for Shift+Arrow.
 */
export function stepAnchor(
  anchorIndex: number | null,
  delta: -1 | 1,
  total: number,
): number | null {
  // An arrow with nothing selected is not a way to start a selection.
  if (anchorIndex === null || total === 0) {
    return null;
  }
  return Math.min(total - 1, Math.max(0, anchorIndex + delta));
}

export function isSelected(selection: Selection, id: number): boolean {
  return selection.ids.has(id);
}

export function selectionCount(selection: Selection): number {
  return selection.ids.size;
}

/** Drops ids that no longer exist, e.g. after a rescan removed files. */
export function pruneSelection(selection: Selection, existingIds: ReadonlySet<number>): Selection {
  const ids = new Set([...selection.ids].filter((id) => existingIds.has(id)));
  return ids.size === selection.ids.size ? selection : { ...selection, ids };
}
