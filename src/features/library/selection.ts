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
