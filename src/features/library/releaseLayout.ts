/**
 * Where each release group sits in a drill-in, and which rows it owns.
 *
 * Arithmetic rather than measurement, and that is the whole point: the
 * virtualizer places every group before a single row of it has been fetched,
 * so scrolling never waits on a page and a group never resizes under the
 * pointer once its rows land.
 *
 * The row counts come from `release_groups`, which is narrowed by the same
 * query the rows are, and the rows arrive ordered by release - see
 * `query::drill_in_order`. Those two facts are what make a prefix sum a
 * correct answer here instead of a guess.
 */

/**
 * A row inside a group, which is shorter than the library's 35px row.
 *
 * The specimen draws 3f at 28, a size larger here, and the closed-form height below is written in
 * terms of it.
 */
export const GROUP_ROW_HEIGHT = 31;

/**
 * Everything in a group that is not a track row: `15 + 15` padding, the
 * closing row, and the 2px rule separating it from the next group.
 */
export const GROUP_CHROME = 15 + 15 + GROUP_ROW_HEIGHT + 2;

/** What the layout needs of a release. */
type Sized = { trackCount: number };

/**
 * A group's height, which is `31n + 63`.
 *
 * The 57px gutter never wins: at `n = 1` the table side is already 94.
 */
export function groupHeight(trackCount: number): number {
  return GROUP_ROW_HEIGHT * trackCount + GROUP_CHROME;
}

/** The row index each group's first row sits at. */
export function groupOffsets(releases: readonly Sized[]): number[] {
  const offsets: number[] = [];
  let next = 0;
  for (const release of releases) {
    offsets.push(next);
    next += release.trackCount;
  }
  return offsets;
}

/**
 * The inclusive row range the groups `[first, last]` own, or null where they
 * own none.
 *
 * Null rather than an empty range because the caller's next move is a fetch,
 * and "no rows" and "row 0" are different requests. Indices past the end of
 * the list are clamped rather than rejected: a narrowing search replaces the
 * list one render before the virtualizer's count catches up.
 */
export function groupRowRange(
  releases: readonly Sized[],
  first: number,
  last: number,
): { start: number; end: number } | null {
  const offsets = groupOffsets(releases);
  const from = Math.max(0, first);
  const to = Math.min(last, releases.length - 1);
  if (from > to) {
    return null;
  }
  const start = offsets[from] as number;
  const end = (offsets[to] as number) + (releases[to] as Sized).trackCount - 1;
  return end < start ? null : { start, end };
}

/**
 * The group holding `rowIndex`, for reaching a row in a view that scrolls by
 * group.
 *
 * The group that *owns* the row rather than the last one starting at or before
 * it: a release narrowed to no rows shares its offset with the next release,
 * and answering with the empty one would scroll past what was asked for. A row
 * past the end answers with the last group, which is where a stale index from
 * a narrowing search should land.
 */
export function groupOfRow(releases: readonly Sized[], rowIndex: number): number {
  const offsets = groupOffsets(releases);
  const found = offsets.findIndex(
    (offset, i) => rowIndex >= offset && rowIndex < offset + (releases[i] as Sized).trackCount,
  );
  return found === -1 ? Math.max(0, releases.length - 1) : found;
}
