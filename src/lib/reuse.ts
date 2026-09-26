/**
 * `next`, with every part equal to `previous` swapped for `previous`'s own.
 *
 * Every IPC answer is freshly parsed JSON, so a store that writes one back
 * wakes each subscriber even when nothing in it moved - a pause re-sends the
 * playing track, and every `library://changed` re-sends the playlists and the
 * view's totals. zustand compares selector output by `Object.is`, so keeping
 * the old identity is what lets an unchanged answer reach nobody. Parts that did
 * change come through new, and keep their unchanged neighbours: one playlist's
 * count moving leaves the other rows' objects alone.
 *
 * JSON shapes only - arrays, plain objects and primitives, which is all IPC can
 * carry.
 */
export function reuse<T>(previous: T, next: T): T {
  if (Object.is(previous, next)) {
    return previous;
  }
  if (Array.isArray(previous) && Array.isArray(next)) {
    let same = previous.length === next.length;
    const merged = next.map((item, index) => {
      const kept = reuse(previous[index], item);
      same &&= kept === previous[index];
      return kept;
    });
    return (same ? previous : merged) as T;
  }
  if (isPlainObject(previous) && isPlainObject(next)) {
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(previous).length;
    const merged: Record<string, unknown> = {};
    for (const key of keys) {
      const kept = reuse(previous[key], next[key]);
      same &&= key in previous && kept === previous[key];
      merged[key] = kept;
    }
    return (same ? previous : merged) as T;
  }
  return next;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype
  );
}
