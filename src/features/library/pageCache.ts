import type { Track } from "../../ipc";

/**
 * Rows are fetched in fixed-size pages and cached by page index, so scrolling
 * a 50k-row table only ever holds the windows the user has actually visited.
 *
 * The cache is deliberately dumb about *how* rows are fetched: it records what
 * is present, what is in flight, and which pages a viewport needs. Fetching
 * belongs to the store, which makes this testable without any IPC.
 */
export const PAGE_SIZE = 200;

/** Pages kept either side of the viewport before older ones are evicted. */
export const CACHE_RADIUS_PAGES = 6;

export type PageState = Map<number, Track[]>;

export function pageIndexOf(rowIndex: number): number {
  return Math.floor(rowIndex / PAGE_SIZE);
}

/** Page indices covering `[startIndex, endIndex]`, inclusive. */
export function pagesForRange(startIndex: number, endIndex: number): number[] {
  if (endIndex < startIndex) {
    return [];
  }
  const first = pageIndexOf(Math.max(0, startIndex));
  const last = pageIndexOf(Math.max(0, endIndex));
  const pages: number[] = [];
  for (let page = first; page <= last; page++) {
    pages.push(page);
  }
  return pages;
}

/** Pages a viewport needs that are neither cached nor already being fetched. */
export function missingPages(
  pages: number[],
  cached: PageState,
  inFlight: ReadonlySet<number>,
): number[] {
  return pages.filter((page) => !cached.has(page) && !inFlight.has(page));
}

/**
 * The row at `rowIndex`, or `null` when its page has not arrived yet.
 *
 * `null` is what the table renders as a placeholder row - scrolling never
 * blocks on a fetch.
 */
export function rowAt(cached: PageState, rowIndex: number): Track | null {
  const page = cached.get(pageIndexOf(rowIndex));
  return page?.[rowIndex % PAGE_SIZE] ?? null;
}

/**
 * A cached row by id, or `null` when no cached page holds it.
 *
 * A scan of the cache rather than an index: it answers for the menu bar, which
 * knows a selection by id and has no row under a pointer to start from, and it
 * is asked once per menu build over at most a few thousand cached rows. An id
 * selected by `Select All` may not be cached at all, which is what `null` says.
 */
export function trackById(cached: PageState, id: number): Track | null {
  for (const rows of cached.values()) {
    const found = rows.find((track) => track.id === id);
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * The row indices a set of selected ids sit at, or null when any of them is
 * not in a cached page.
 *
 * All-or-nothing on purpose. The caller reorders a playlist by index, and a
 * partial answer would move some of a selection and leave the rest - so an id
 * the cache cannot place has to stop the whole move rather than shrink it.
 * `Select All` over a large playlist is exactly that case, and it is also a
 * move with no meaning.
 */
export function rowIndicesOf(cached: PageState, ids: ReadonlySet<number>): number[] | null {
  const indices: number[] = [];
  for (const [page, rows] of cached) {
    rows.forEach((track, offset) => {
      if (ids.has(track.id)) {
        indices.push(page * PAGE_SIZE + offset);
      }
    });
  }
  if (indices.length !== ids.size) {
    return null;
  }
  return indices.sort((left, right) => left - right);
}

/**
 * Drops pages far from the viewport so memory stays flat during a long scroll
 * through a large library.
 */
export function evictFarPages(cached: PageState, visiblePages: number[]): PageState {
  if (visiblePages.length === 0) {
    return cached;
  }
  const low = Math.min(...visiblePages) - CACHE_RADIUS_PAGES;
  const high = Math.max(...visiblePages) + CACHE_RADIUS_PAGES;

  const kept: PageState = new Map();
  for (const [page, rows] of cached) {
    if (page >= low && page <= high) {
      kept.set(page, rows);
    }
  }
  return kept;
}
